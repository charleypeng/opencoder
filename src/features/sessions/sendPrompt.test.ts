// L1 tests for the shared send pipeline (TASK-M2-10, extracted from
// PromptBox): the optimistic user message lands in the store and the POST
// carries the text part, the per-server history records the prompt, a
// failure rolls the optimistic message back and resolves to the classified
// error, and an empty prompt is a no-op.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/errors";
import type { Session } from "../../services/session";
import { applySessionList, resetServer as resetSessions } from "../../stores/session";
import { messages, resetServer as resetMessages } from "../../stores/messages";
import { clearPrompts, readPrompts } from "./promptHistory";
import { sendPrompt } from "./sendPrompt";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-send";
const SESSION = "ses_send_01";

function sessionFixture(): Session {
  return {
    id: SESSION,
    slug: "send-session",
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: "Send session",
    agent: "build",
    model: { id: "gpt-5", providerID: "openai" },
    version: "1.18.11",
    time: { created: 1, updated: 1 },
  } as Session;
}

function mockClient() {
  const client = {
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => []),
    post: vi.fn<(path: string, options?: { body?: unknown }) => Promise<unknown>>(
      async () => undefined,
    ),
    patch: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => undefined),
    delete: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

let client: ReturnType<typeof mockClient>;

beforeEach(() => {
  resetSessions(SERVER);
  resetMessages(SERVER);
  clearPrompts(SERVER);
  getApiClientMock.mockReset();
  client = mockClient();
  applySessionList(SERVER, [sessionFixture()]);
});
afterEach(() => {
  resetSessions(SERVER);
  resetMessages(SERVER);
  clearPrompts(SERVER);
});

describe("sendPrompt", () => {
  it("inserts the optimistic message, records history and POSTs the text part", async () => {
    const err = await sendPrompt(SERVER, SESSION, "Explain the SSE stream");

    expect(err).toBeNull();
    expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
      body: { parts: [{ type: "text", text: "Explain the SSE stream" }] },
    });
    const entry = messages[SERVER]?.[SESSION];
    expect(entry?.order).toHaveLength(1);
    const part = entry?.parts[entry.order[0]];
    expect(part).toMatchObject({ type: "text", text: "Explain the SSE stream" });
    expect(entry?.infos[part?.messageID as string]).toMatchObject({
      role: "user",
      sessionID: SESSION,
    });
    expect(readPrompts(SERVER)).toEqual(["Explain the SSE stream"]);
  });

  it("rolls the optimistic message back and returns the error on POST failure", async () => {
    client.post.mockRejectedValueOnce(new ApiError(500, "http", "boom", true));

    const err = await sendPrompt(SERVER, SESSION, "doomed prompt");

    expect(err).not.toBeNull();
    expect(err?.status).toBe(500);
    const entry = messages[SERVER]?.[SESSION];
    expect(entry?.order ?? []).toEqual([]);
    expect(Object.keys(entry?.infos ?? {})).toEqual([]);
  });

  it("returns the classified error for rate-limit failures", async () => {
    client.post.mockRejectedValueOnce(new ApiError(429, "http", "rate limit exceeded", true));

    const err = await sendPrompt(SERVER, SESSION, "again");

    expect(err?.message).toContain("rate limit");
  });

  it("trims the prompt before sending", async () => {
    await sendPrompt(SERVER, SESSION, "  padded prompt  ");

    expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
      body: { parts: [{ type: "text", text: "padded prompt" }] },
    });
  });

  it("is a no-op for an empty prompt", async () => {
    const err = await sendPrompt(SERVER, SESSION, "   ");

    expect(err).toBeNull();
    expect(client.post).not.toHaveBeenCalled();
    expect(messages[SERVER]?.[SESSION]).toBeUndefined();
    expect(readPrompts(SERVER)).toEqual([]);
  });

  it("is a no-op for an empty prompt without attachments", async () => {
    const err = await sendPrompt(SERVER, SESSION, "   ", []);

    expect(err).toBeNull();
    expect(client.post).not.toHaveBeenCalled();
  });

  it("sends attachment file parts after the text part", async () => {
    const err = await sendPrompt(SERVER, SESSION, "check this", [
      {
        id: "att-1",
        category: "image",
        kind: "data-url",
        name: "clip.png",
        mimeType: "image/png",
        content: "data:image/png;base64,aGVsbG8=",
      },
    ]);

    expect(err).toBeNull();
    expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
      body: {
        parts: [
          { type: "text", text: "check this" },
          {
            type: "file",
            mime: "image/png",
            filename: "clip.png",
            url: "data:image/png;base64,aGVsbG8=",
          },
        ],
      },
    });
    // Optimistic store + history only cover the text part.
    const entry = messages[SERVER]?.[SESSION];
    const part = entry?.parts[entry.order[0]];
    expect(part).toMatchObject({ type: "text", text: "check this" });
    expect(readPrompts(SERVER)).toEqual(["check this"]);
  });

  it("sends attachments even when the text part is empty", async () => {
    const err = await sendPrompt(SERVER, SESSION, "", [
      {
        id: "att-2",
        category: "file",
        kind: "text",
        name: "notes.txt",
        mimeType: "text/plain",
        content: "hello",
      },
    ]);

    expect(err).toBeNull();
    expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
      body: {
        parts: [
          {
            type: "file",
            mime: "text/plain",
            filename: "notes.txt",
            url: "data:text/plain;charset=utf-8,hello",
          },
        ],
      },
    });
  });

  it("carries the selected agent in the prompt body and the optimistic message", async () => {
    const err = await sendPrompt(SERVER, SESSION, "plan the migration", [], "plan");

    expect(err).toBeNull();
    expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
      body: { parts: [{ type: "text", text: "plan the migration" }], agent: "plan" },
    });
    const entry = messages[SERVER]?.[SESSION];
    const part = entry?.parts[entry.order[0]];
    expect(entry?.infos[part?.messageID as string]).toMatchObject({ agent: "plan" });
  });

  it("carries the selected model in the prompt body and the optimistic message", async () => {
    const err = await sendPrompt(SERVER, SESSION, "draft with gpt-5", [], undefined, {
      providerID: "openai",
      modelID: "gpt-5",
    });

    expect(err).toBeNull();
    expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
      body: {
        parts: [{ type: "text", text: "draft with gpt-5" }],
        model: { providerID: "openai", modelID: "gpt-5" },
      },
    });
    const entry = messages[SERVER]?.[SESSION];
    const part = entry?.parts[entry.order[0]];
    expect(entry?.infos[part?.messageID as string]).toMatchObject({
      model: { providerID: "openai", modelID: "gpt-5" },
    });
  });
});
