// L1 tests for the shell send path (TASK-M5-08): the `!` router extraction
// and the store application of the synchronous POST /session/{id}/shell
// response, plus error classification and the no-history guarantee.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/errors";
import type { Session } from "../../services/session";
import { applySessionList, resetServer as resetSessions } from "../../stores/session";
import { messages, resetServer as resetMessages } from "../../stores/messages";
import { clearPrompts, readPrompts } from "./promptHistory";
import { runShell, shellCommandOf } from "./sendShell";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-shell";
const SESSION = "ses_shell_01";

function sessionFixture(): Session {
  return {
    id: SESSION,
    slug: "shell-session",
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: "Shell session",
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

describe("shellCommandOf", () => {
  it("extracts the text after a leading !", () => {
    expect(shellCommandOf("!ls -la")).toBe("ls -la");
    expect(shellCommandOf("!  git status")).toBe("git status");
  });

  it("returns null for non-! messages and a bare !", () => {
    expect(shellCommandOf("ls -la")).toBeNull();
    expect(shellCommandOf("!")).toBeNull();
    expect(shellCommandOf("!   ")).toBeNull();
  });
});

describe("runShell", () => {
  it("POSTs /session/{id}/shell with command + agent and applies the message to the store", async () => {
    client.post.mockResolvedValue({
      info: {
        id: "msg_asst_shell_1",
        sessionID: SESSION,
        role: "assistant",
        time: { created: 1 },
      },
      parts: [
        {
          id: "prt_shell_1",
          sessionID: SESSION,
          messageID: "msg_asst_shell_1",
          type: "text",
          text: "$ ls\nsrc",
        },
      ],
    });

    const err = await runShell(SERVER, SESSION, "ls", "build", {
      providerID: "openai",
      modelID: "gpt-5",
    });

    expect(err).toBeNull();
    expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/shell`, {
      body: {
        command: "ls",
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5" },
      },
    });
    const entry = messages[SERVER]?.[SESSION];
    expect(entry?.order).toHaveLength(1);
    const part = entry?.parts[entry.order[0]];
    expect(part).toMatchObject({ type: "text", text: "$ ls\nsrc" });
    expect(entry?.infos["msg_asst_shell_1"]).toMatchObject({ role: "assistant" });
  });

  it("omits the model from the body when not provided", async () => {
    client.post.mockResolvedValue({
      info: { id: "msg_asst_shell_2", sessionID: SESSION, role: "assistant" },
      parts: [],
    });

    const err = await runShell(SERVER, SESSION, "pwd", "build");

    expect(err).toBeNull();
    expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/shell`, {
      body: { command: "pwd", agent: "build" },
    });
  });

  it("returns the classified error on failure and leaves the store untouched", async () => {
    client.post.mockRejectedValueOnce(new ApiError(500, "http", "shell boom", true));

    const err = await runShell(SERVER, SESSION, "rm -rf /", "build");

    expect(err?.status).toBe(500);
    expect(messages[SERVER]?.[SESSION]).toBeUndefined();
  });

  it("never records ! entries in the prompt history", async () => {
    client.post.mockResolvedValue({
      info: { id: "msg_asst_shell_3", sessionID: SESSION, role: "assistant" },
      parts: [],
    });

    await runShell(SERVER, SESSION, "ls", "build");

    expect(readPrompts(SERVER)).toEqual([]);
  });
});
