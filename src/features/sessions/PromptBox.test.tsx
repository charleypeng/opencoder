// L2 tests for the prompt box (TASK-M2-08 / M2-10 / M3-08): ⌘/Ctrl+Enter
// sends (plain Enter only inserts a newline), the POST body carries the
// text part, the optimistic user message lands in the store and the
// textarea clears, the input locks while the session is busy/retry or a
// send is in flight, a failed POST rolls the optimistic message back and
// shows an error banner, ↑ on an empty input recalls and cycles the
// per-server prompt history, and an integration-style chain (optimistic
// send -> happy-chat SSE events through applyEvent -> store/render) ends
// with the sent prompt and the assistant reply on screen, with the
// optimistic bubble reconciled onto the server-issued user message (no
// local-* duplicates; full-chain E2E E03 itself lands with the M10 infra).
// M2-10 additions: while busy the Send button is replaced by a Stop button
// that POSTs /session/{id}/abort (double-clicks collapsed to one call), Esc
// does the same, an abort failure surfaces as the inline banner, and the
// Send button returns once the session turns idle. M3-08 additions: the
// attachment button opens a file picker, clipboard images and dropped
// files become removable chips (cleared on a successful send, kept for
// retry on failure), the M7 image-pick button is a disabled placeholder,
// and `@` at a word start opens a debounced /find/file reference menu with
// ↑↓/Enter/Esc keyboard navigation inserting the chosen path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import PromptBox from "./PromptBox";
import MessageList from "../messages/MessageList";
import { clearPrompts } from "./promptHistory";
import { ApiError } from "../../services/errors";
import type { Session } from "../../services/session";
import { MAX_ATTACHMENT_BYTES } from "./attachments";
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
    // Input cleared and re-enabled after the round-trip (the shared
    // sendPrompt pipeline resolves a microtask later than the old inline
    // flow, so the re-enable is awaited).
    expect(input().value).toBe("");
    await waitFor(() => expect(input()).not.toBeDisabled());
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

  it("locks the input while the session is busy or retry", () => {
    // TASK-M2-09: the thin streaming progress bar moved to the top of the
    // chat area (MessageList, "streaming-progress"); the input lock below is
    // what PromptBox itself owns.
    setSessionStatus(SERVER, SESSION, { type: "busy" });
    const { unmount } = render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    expect(input()).toBeDisabled();
    expect(input()).toHaveAttribute("placeholder", "Generating…");
    expect(screen.queryByTestId("prompt-generating")).not.toBeInTheDocument();

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

  it("replaces Send with a Stop button while busy and aborts on click (no double stop)", async () => {
    setSessionStatus(SERVER, SESSION, { type: "busy" });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    const stop = screen.getByTestId("prompt-stop") as HTMLButtonElement;
    expect(screen.queryByTestId("prompt-send")).not.toBeInTheDocument();
    expect(stop).not.toBeDisabled();

    fireEvent.click(stop);
    fireEvent.click(stop);

    await waitFor(() => expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/abort`));
    expect(client.post).toHaveBeenCalledTimes(1);
    // Still busy until the server answers with idle via SSE.
    expect(screen.getByTestId("prompt-stop")).toBeInTheDocument();
  });

  it("Esc aborts while the session is generating", async () => {
    setSessionStatus(SERVER, SESSION, { type: "busy" });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/abort`));
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it("restores the Send button and unlocks the input once the session turns idle", () => {
    setSessionStatus(SERVER, SESSION, { type: "busy" });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    expect(screen.getByTestId("prompt-stop")).toBeInTheDocument();

    setSessionStatus(SERVER, SESSION, { type: "idle" });

    expect(screen.queryByTestId("prompt-stop")).not.toBeInTheDocument();
    expect(screen.getByTestId("prompt-send")).toBeInTheDocument();
    expect(input()).not.toBeDisabled();
  });

  it("shows an inline banner when the abort request fails", async () => {
    client.post.mockRejectedValueOnce(new ApiError(500, "http", "abort boom", true));
    setSessionStatus(SERVER, SESSION, { type: "busy" });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.click(screen.getByTestId("prompt-stop"));

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.getByTestId("error-banner-title")).toHaveTextContent("Server error");
    // The session is still generating: stop stays available for another try.
    expect(screen.getByTestId("prompt-stop")).toBeInTheDocument();
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

  it("adds files through the attachment button file picker", async () => {
    const file = new File(["picked"], "pick.txt", { type: "text/plain" });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    const attach = screen.getByTestId("prompt-attach");
    expect(attach).toBeEnabled();
    const picker = screen.getByTestId("prompt-file-input") as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("pick.txt")).toBeInTheDocument());
  });

  it("shows the M7 image picker placeholder as a disabled button", () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    const pick = screen.getByTestId("prompt-pick-image");
    expect(pick).toBeDisabled();
    expect(pick).toHaveAttribute("title", expect.stringContaining("M7"));
  });

  it("pastes a clipboard image as a removable attachment chip", async () => {
    const file = new File(["png-bytes"], "clip.png", { type: "image/png" });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.paste(input(), {
      clipboardData: { items: [{ type: "image/png", getAsFile: () => file }] },
    });

    await waitFor(() => expect(screen.getByText("clip.png")).toBeInTheDocument());
    // The pasted image does not leak text into the input.
    expect(input().value).toBe("");
  });

  it("does not treat a text-only paste as an attachment", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.paste(input(), {
      clipboardData: { items: [{ type: "text/plain", getAsFile: () => null }] },
    });

    expect(screen.queryByText(/clip|\.png/i)).not.toBeInTheDocument();
  });

  it("drops files onto the composer as attachment chips", async () => {
    const textFile = new File(["line one"], "notes.txt", { type: "text/plain" });
    const imageFile = new File(["png-bytes"], "shot.png", { type: "image/png" });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.drop(screen.getByTestId("prompt-box"), {
      dataTransfer: { files: [textFile, imageFile] },
    });

    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("shot.png")).toBeInTheDocument());
  });

  it("removes an attachment chip with its × button", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    fireEvent.drop(screen.getByTestId("prompt-box"), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("attachment-remove"));

    await waitFor(() => expect(screen.queryByText("notes.txt")).not.toBeInTheDocument());
    expect(screen.getByTestId("prompt-send")).toBeDisabled();
  });

  it("sends attachment file parts after the text part and clears chips on success", async () => {
    const file = new File(["line one"], "notes.txt", { type: "text/plain" });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    fireEvent.drop(screen.getByTestId("prompt-box"), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());

    fireEvent.input(input(), { target: { value: "check this" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
        body: {
          parts: [
            { type: "text", text: "check this" },
            {
              type: "file",
              mime: "text/plain",
              filename: "notes.txt",
              url: "data:text/plain;charset=utf-8,line%20one",
            },
          ],
        },
      }),
    );
    // Chips clear once the send round-trip succeeds.
    await waitFor(() => expect(screen.queryByText("notes.txt")).not.toBeInTheDocument());
  });

  it("keeps the attachments for retry when the send fails", async () => {
    const file = new File(["line one"], "notes.txt", { type: "text/plain" });
    client.post.mockRejectedValueOnce(new ApiError(500, "http", "boom", true));
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    fireEvent.drop(screen.getByTestId("prompt-box"), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());

    fireEvent.input(input(), { target: { value: "doomed" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("rejects an oversized file and shows the error near the chips", async () => {
    const huge = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    const file = new File([huge], "huge.bin", { type: "application/octet-stream" });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.drop(screen.getByTestId("prompt-box"), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByTestId("attachment-error")).toBeInTheDocument());
    expect(screen.getByTestId("attachment-error")).toHaveTextContent(/too large/i);
    expect(screen.queryByText("huge.bin")).not.toBeInTheDocument();
  });

  it("@ opens the file reference menu; ↑↓ + Enter inserts the path", async () => {
    client.get.mockImplementation(async (path: string) => {
      if (path === "/find/file") {
        return ["src/features/sessions/PromptBox.tsx", "src/services/find.ts"];
      }
      return [];
    });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "see @find" } });

    await waitFor(() => expect(screen.getByTestId("prompt-at-menu")).toBeInTheDocument());
    // Items arrive after the 150ms debounce + the /find/file round-trip.
    await waitFor(() => expect(screen.getAllByTestId("prompt-at-item")).toHaveLength(2));

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(input().value).toBe("see @src/services/find.ts");
    expect(screen.queryByTestId("prompt-at-menu")).not.toBeInTheDocument();
  });

  it("@ menu queries the file search with the word after @", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "refer @PromptBox" } });

    await waitFor(() =>
      expect(client.get).toHaveBeenCalledWith("/find/file", {
        query: { query: "PromptBox" },
      }),
    );
  });

  it("@ menu debounces: consecutive keystrokes collapse into one query", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "@x" } });
    fireEvent.input(input(), { target: { value: "@xy" } });

    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(1));
    expect(client.get).toHaveBeenCalledWith("/find/file", { query: { query: "xy" } });
  });

  it("Esc closes the @ menu without inserting anything", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "@find" } });
    await waitFor(() => expect(screen.getByTestId("prompt-at-menu")).toBeInTheDocument());

    fireEvent.keyDown(input(), { key: "Escape" });

    expect(screen.queryByTestId("prompt-at-menu")).not.toBeInTheDocument();
    expect(input().value).toBe("@find");
  });

  it("@ inside a word (not at a word start) does not open the menu", () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "mail@example.com" } });

    expect(screen.queryByTestId("prompt-at-menu")).not.toBeInTheDocument();
  });

  it("inserts @ references at the caret when it moved off the query", async () => {
    client.get.mockImplementation(async (path: string) => {
      if (path === "/find/file") return ["src/services/find.ts"];
      return [];
    });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "see @find" } });
    await waitFor(() => expect(screen.getAllByTestId("prompt-at-item")).toHaveLength(1));

    // The caret moved to the start while the menu stayed open: the path is
    // inserted at the caret instead of splicing at the stale @ position.
    input().setSelectionRange(0, 0);
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(input().value).toBe("@src/services/find.tssee @find");
    expect(screen.queryByTestId("prompt-at-menu")).not.toBeInTheDocument();
  });

  it("keeps the keyboard-selected @ option in view while navigating", async () => {
    const scrolled: HTMLElement[] = [];
    const scrollIntoView = vi.fn(function (this: HTMLElement) {
      scrolled.push(this);
    });
    Element.prototype.scrollIntoView = scrollIntoView;
    client.get.mockImplementation(async (path: string) => {
      if (path === "/find/file") return ["a.ts", "b.ts", "c.ts", "d.ts"];
      return [];
    });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "@x" } });
    await waitFor(() => expect(screen.getAllByTestId("prompt-at-item")).toHaveLength(4));

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });

    await waitFor(() => expect(scrolled.length).toBeGreaterThanOrEqual(3));
    expect(scrolled[scrolled.length - 1]).toHaveAttribute("aria-selected", "true");
    expect(scrolled[scrolled.length - 1]).toHaveTextContent("c.ts");
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
