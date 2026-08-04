// L2 tests for the prompt box (TASK-M2-08): ⌘/Ctrl+Enter sends (plain Enter
// only inserts a newline), the POST body carries the text part, the
// optimistic user message lands in the store and the textarea clears, the
// input locks while the session is busy/retry or a send is in flight, a
// failed POST rolls the optimistic message back and shows an error banner,
// ↑ on an empty input recalls and cycles the per-server prompt history, the
// attachment button is a disabled M3 placeholder, and an integration-style
// chain (optimistic send -> happy-chat SSE events through applyEvent ->
// store/render) ends with the sent prompt and the assistant reply on screen,
// with the optimistic bubble reconciled onto the server-issued user message
// (no local-* duplicates; full-chain E2E E03 itself lands with the M10
// infra).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import PromptBox from "./PromptBox";
import MessageList from "../messages/MessageList";
import { clearPrompts } from "./promptHistory";
import { ApiError } from "../../services/errors";
import type { Session } from "../../services/session";
import {
  applySessionList,
  resetServer as resetSessions,
  setSessionStatus,
} from "../../stores/session";
import { messages, resetServer as resetMessages } from "../../stores/messages";
import { applyEvent } from "../../stores/events";
import type { SseEvent } from "../../services/sse";
import { scenarios } from "../../../tests/mock-server/scenarios/index.js";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));
// events.ts pulls in the SSE facade (tauri Channel); not needed in tests.
vi.mock("../../services/sse.js", () => ({ sseSubscribe: vi.fn() }));

const SERVER = "srv-prompt";
const SESSION = "ses_prompt_01";
const DEMO_DIR = "/mock/projects/opencode-demo";

function sessionFixture(): Session {
  return {
    id: SESSION,
    slug: "prompt-session",
    projectID: "project-mock-1",
    directory: DEMO_DIR,
    title: "Prompt session",
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

function input(): HTMLTextAreaElement {
  return screen.getByTestId("prompt-input") as HTMLTextAreaElement;
}

async function typeAndSend(text: string, expectedPosts: number) {
  fireEvent.input(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
  await waitFor(() => expect(client.post).toHaveBeenCalledTimes(expectedPosts));
}

describe("PromptBox", () => {
  it("renders the composer with a disabled send button for empty input", () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    expect(input()).toBeInTheDocument();
    expect(input().value).toBe("");
    expect(screen.getByTestId("prompt-send")).toBeDisabled();
    expect(screen.getByText("⌘/Ctrl+Enter to send")).toBeInTheDocument();
  });

  it("sends on ⌘/Ctrl+Enter: POST with the text part, optimistic store insert, cleared textarea", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "Explain the SSE stream" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
        body: { parts: [{ type: "text", text: "Explain the SSE stream" }] },
      }),
    );

    // Optimistic user message + text part in the store, keyed by local ids.
    const entry = messages[SERVER]?.[SESSION];
    expect(entry?.order).toHaveLength(1);
    const part = entry?.parts[entry.order[0]];
    expect(part).toMatchObject({ type: "text", text: "Explain the SSE stream" });
    expect(entry?.infos[part?.messageID as string]).toMatchObject({
      role: "user",
      sessionID: SESSION,
    });
    // Input cleared and re-enabled after the round-trip.
    expect(input().value).toBe("");
    expect(input()).not.toBeDisabled();
  });

  it("sends with Ctrl+Enter as well", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "hello" } });
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
    expect(input().value).toBe("");
  });

  it("plain Enter does not send and keeps the text", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "line one" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(client.post).not.toHaveBeenCalled();
    expect(input().value).toBe("line one");
  });

  it("locks the input while the session is busy or retry, with a generating indicator", () => {
    setSessionStatus(SERVER, SESSION, { type: "busy" });
    const { unmount } = render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    expect(input()).toBeDisabled();
    expect(input()).toHaveAttribute("placeholder", "Generating…");
    expect(screen.getByTestId("prompt-generating")).toBeInTheDocument();

    unmount();
    setSessionStatus(SERVER, SESSION, {
      type: "retry",
      attempt: 2,
      message: "retrying",
      next: 5,
    });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    expect(input()).toBeDisabled();
  });

  it("locks the input when disabled by prop", () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} disabled />);
    expect(input()).toBeDisabled();
  });

  it("rolls back the optimistic message and shows an error banner on POST failure", async () => {
    client.post.mockRejectedValueOnce(new ApiError(500, "http", "boom", true));
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    await typeAndSend("doomed prompt", 1);

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.getByTestId("error-banner-title")).toHaveTextContent("Server error");

    // The optimistic message was rolled back from the store.
    const entry = messages[SERVER]?.[SESSION];
    expect(entry?.order ?? []).toEqual([]);
    expect(Object.keys(entry?.infos ?? {})).toEqual([]);
    // The input is usable again (text kept was cleared, error dismissable).
    expect(input()).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("error-banner-dismiss"));
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });

  it("↑ on an empty input recalls and cycles the prompt history", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await typeAndSend("first prompt", 1);
    await typeAndSend("second prompt", 2);

    expect(input().value).toBe("");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input().value).toBe("second prompt");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input().value).toBe("first prompt");
    // Oldest reached: stays put.
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input().value).toBe("first prompt");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().value).toBe("second prompt");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().value).toBe("");
  });

  it("↑ does not recall when the input is not empty", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await typeAndSend("only prompt", 1);

    fireEvent.input(input(), { target: { value: "editing" } });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input().value).toBe("editing");
  });

  it("keeps the recalled prompt until sent or edited", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await typeAndSend("recalled prompt", 1);

    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input().value).toBe("recalled prompt");
    // Editing exits the browse mode so the next ↑ goes to the newest again.
    fireEvent.input(input(), { target: { value: "recalled prompt, edited" } });
    expect(input().value).toBe("recalled prompt, edited");
  });

  it("shows the attachment button as a disabled M3 placeholder", () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    const attach = screen.getByTestId("prompt-attach");
    expect(attach).toBeDisabled();
    expect(attach).toHaveAttribute("title", "Attachments — M3");
  });

  it("full chain: optimistic send plus SSE happy-chat events render user and assistant", async () => {
    // The scenario fixture is written against ses_abc123; mount the composer
    // and the list on that session so the replayed events land in the same
    // bucket the components read.
    applySessionList(SERVER, [
      { ...sessionFixture(), id: "ses_abc123", slug: "happy-chat", title: "Happy chat" },
    ]);
    render(() => (
      <>
        <MessageList serverId={SERVER} sessionId="ses_abc123" />
        <PromptBox serverId={SERVER} sessionId="ses_abc123" />
      </>
    ));

    await typeAndSend("Explain the SSE stream", 1);
    // The optimistic bubble is on screen before any SSE event.
    expect(screen.getByText("Explain the SSE stream")).toBeInTheDocument();

    // The mock server returns 204 without emitting SSE; drive the happy-chat
    // scenario through the router like the real stream would (E2E E03 lands
    // with the M10 infra).
    const happyChat = scenarios["happy-chat"];
    for (const step of happyChat) {
      if (step.event) applyEvent(SERVER, step.event as SseEvent);
    }

    await waitFor(() =>
      expect(screen.getByText(/Hello! I can help with that/)).toBeInTheDocument(),
    );
    expect(screen.getByText("Explain the SSE stream")).toBeInTheDocument();
    expect(screen.getByText(/Found 3 files. I will summarize them for you/)).toBeInTheDocument();
    // TASK-M2-08: the optimistic bubble was reconciled onto the echoed user
    // message — exactly one user bubble carries the prompt text and no
    // local-* ids survive in the store.
    expect(screen.getAllByText("Explain the SSE stream")).toHaveLength(1);
    const entry = messages[SERVER]?.["ses_abc123"];
    expect(Object.keys(entry?.infos ?? {})).toEqual(["msg_user_001"]);
    for (const id of [...Object.keys(entry?.parts ?? {}), ...(entry?.order ?? [])]) {
      expect(id.startsWith("local-")).toBe(false);
    }
    // The stream ended idle, so the input is unlocked again.
    expect(input()).not.toBeDisabled();
  });
});
