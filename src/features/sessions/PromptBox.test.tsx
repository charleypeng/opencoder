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
// ↑↓/Enter/Esc keyboard navigation inserting the chosen path. M5-04
// additions: the agent chip (toolbar row above the textarea) shows the
// effective agent with its color dot, opens a menu of the visible agents
// (name/mode/description, hidden agents filtered out, check on the
// current), records per-session choices in the agents store, Tab in the
// textarea cycles the visible agents, and the send POST carries the
// selected agent in the prompt_async body.

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
import { composerPrefill, consumeComposerPrefill, prefillComposer } from "../../stores/composer";
import { agentNameFor, resetServer as resetAgents } from "../../stores/agents";
import { activeModelFor, resetServer as resetModels } from "../../stores/models";
import { applyEvent } from "../../stores/events";
import type { SseEvent } from "../../services/sse";
import { scenarios } from "../../../tests/mock-server/scenarios/index.js";
import { resetAllShortcuts, saveShortcutCombo } from "../settings/shortcutStore.js";

const { getApiClientMock, hapticMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  hapticMock: vi.fn(),
}));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));
// events.ts pulls in the SSE facade (tauri Channel); not needed in tests.
vi.mock("../../services/sse.js", () => ({ sseSubscribe: vi.fn() }));
// TASK-M7-07: the haptic facade is mocked so the send call site can be
// asserted (the facade's own guard/dispatch is covered in
// src/services/haptics.test.ts).
vi.mock("../../services/haptics.js", () => ({ haptic: hapticMock }));

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
  resetAgents(SERVER);
  resetModels(SERVER);
  clearPrompts(SERVER);
  window.localStorage.clear();
  getApiClientMock.mockReset();
  client = mockClient();
  applySessionList(SERVER, [sessionFixture()]);
});
afterEach(() => {
  resetSessions(SERVER);
  resetMessages(SERVER);
  resetAgents(SERVER);
  resetModels(SERVER);
  clearPrompts(SERVER);
  window.localStorage.clear();
  resetAllShortcuts();
  consumeComposerPrefill();
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

  it("prefills the input from the composer store exactly once (TASK-M7-10)", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    expect(input().value).toBe("");

    // A shared text lands in the store (Android share receive) and the
    // composer applies it, consuming the pending slot.
    prefillComposer("  shared into the composer  ");
    await waitFor(() => expect(input().value).toBe("shared into the composer"));
    expect(input().selectionStart).toBe("shared into the composer".length);
    expect(composerPrefill()).toBeNull();

    // The prefill is consumed: a store write with no prefill does not
    // touch the input again.
    fireEvent.input(input(), { target: { value: "typed after" } });
    expect(input().value).toBe("typed after");
  });

  it("applies a prefill that arrived before the composer mounted (TASK-M7-10)", () => {
    prefillComposer("queued while hidden");
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    expect(input().value).toBe("queued while hidden");
    expect(composerPrefill()).toBeNull();
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

  it("fires the send haptic when sending (TASK-M7-07)", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "hello" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() => expect(hapticMock).toHaveBeenCalledWith("send"));
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

  it("sends on a customized bare-Enter combo (TASK-M8-01 regression)", async () => {
    // Remapping sendMessage to a bare Enter must re-wire the composer:
    // the old ⌘/Ctrl+Enter stops sending and the plain key sends instead.
    saveShortcutCombo("sendMessage", {
      key: "enter",
      ctrl: false,
      meta: false,
      shift: false,
      alt: false,
    });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "plain enter" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
    expect(input().value).toBe("");

    fireEvent.input(input(), { target: { value: "cmd enter" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
    expect(input().value).toBe("cmd enter");
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

    await waitFor(() =>
      expect(client.get).toHaveBeenCalledWith("/find/file", { query: { query: "xy" } }),
    );
    const findCalls = client.get.mock.calls.filter(([path]) => path === "/find/file");
    expect(findCalls).toHaveLength(1);
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

// TASK-M5-03: `/` command menu and command execution.
describe("PromptBox slash commands", () => {
  const COMMANDS = [
    {
      name: "init",
      description: "Initialize a CLAUDE.md file",
      template: "Create a CLAUDE.md file describing this project.",
      hints: ["A summary of the codebase"],
    },
    {
      name: "compact",
      description: "Compress the conversation history",
      template: "Summarize this conversation.",
      hints: [],
    },
    {
      name: "think",
      description: "Think about a question (custom server command)",
      template: "Think deeply about: $ARGUMENT",
      hints: ["What should I think about?"],
    },
  ];

  beforeEach(() => {
    client.get.mockImplementation(async (path: string) => {
      if (path === "/command") return COMMANDS;
      return [];
    });
  });

  it("`/` opens the command menu listing name, description and hint (fetched once)", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "/" } });

    await waitFor(() => expect(screen.getByTestId("prompt-slash-menu")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId("prompt-slash-item")).toHaveLength(3));
    expect(client.get).toHaveBeenCalledWith("/command", undefined);
    expect(screen.getByText("init")).toBeInTheDocument();
    expect(screen.getByText(/Initialize a CLAUDE\.md file/)).toBeInTheDocument();
    expect(screen.getByText("A summary of the codebase")).toBeInTheDocument();

    // The command list is cached per mount: more typing does not refetch
    // (the mount-time /agent fetch is the only other GET).
    fireEvent.input(input(), { target: { value: "/i" } });
    await waitFor(() => expect(screen.getAllByTestId("prompt-slash-item")).toHaveLength(2));
    const commandCalls = client.get.mock.calls.filter(([path]) => path === "/command");
    expect(commandCalls).toHaveLength(1);
  });

  it("filters the menu by the query after `/`", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "/com" } });

    await waitFor(() => expect(screen.getAllByTestId("prompt-slash-item")).toHaveLength(1));
    expect(screen.getByText("compact")).toBeInTheDocument();
  });

  it("select fills the template with the argument hint as editable text", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "/" } });
    await waitFor(() => expect(screen.getAllByTestId("prompt-slash-item")).toHaveLength(3));

    fireEvent.keyDown(input(), { key: "Enter" });

    expect(input().value).toBe("/init A summary of the codebase");
    expect(screen.queryByTestId("prompt-slash-menu")).not.toBeInTheDocument();
  });

  it("↑↓ navigate and Enter fills the template without a hint", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "/" } });
    await waitFor(() => expect(screen.getAllByTestId("prompt-slash-item")).toHaveLength(3));
    expect(screen.getAllByTestId("prompt-slash-item")[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(screen.getAllByTestId("prompt-slash-item")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(screen.getAllByTestId("prompt-slash-item")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(input().value).toBe("/compact");
    expect(screen.queryByTestId("prompt-slash-menu")).not.toBeInTheDocument();
  });

  it("Esc closes the command menu without filling anything", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "/in" } });
    await waitFor(() => expect(screen.getByTestId("prompt-slash-menu")).toBeInTheDocument());

    fireEvent.keyDown(input(), { key: "Escape" });

    expect(screen.queryByTestId("prompt-slash-menu")).not.toBeInTheDocument();
    expect(input().value).toBe("/in");
  });

  it("does not open for `/` mid-text", () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "see /init" } });

    expect(screen.queryByTestId("prompt-slash-menu")).not.toBeInTheDocument();
  });

  it("@-menu coordination: the @ condition wins on a mixed line", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    // `/init @x` matches both trigger shapes on paper; the @ reference at a
    // word start wins and the slash query (containing a space) stays quiet.
    fireEvent.input(input(), { target: { value: "/init @x" } });

    await waitFor(() => expect(screen.getByTestId("prompt-at-menu")).toBeInTheDocument());
    expect(screen.queryByTestId("prompt-slash-menu")).not.toBeInTheDocument();
  });

  it("@-menu coordination: clearing an open @ menu lets `/` take over", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "see @find" } });
    await waitFor(() => expect(screen.getByTestId("prompt-at-menu")).toBeInTheDocument());

    fireEvent.input(input(), { target: { value: "/x" } });

    await waitFor(() => expect(screen.getByTestId("prompt-slash-menu")).toBeInTheDocument());
    expect(screen.queryByTestId("prompt-at-menu")).not.toBeInTheDocument();
  });

  it("submitting a known command POSTs /session/{id}/command and clears the input", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "/init" } });
    await waitFor(() => expect(screen.getAllByTestId("prompt-slash-item")).toHaveLength(1));
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/command`, {
        body: { command: "init", arguments: "" },
      }),
    );
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("");
  });

  it("submitting a command with arguments sends the text after the name", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "/think what is a tenbagger?" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/command`, {
        body: { command: "think", arguments: "what is a tenbagger?" },
      }),
    );
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it("keeps attachment chips and shows a one-time note when a command is submitted", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.drop(screen.getByTestId("prompt-box"), {
      dataTransfer: { files: [new File(["line one"], "notes.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());

    fireEvent.input(input(), { target: { value: "/init" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/command`, {
        body: { command: "init", arguments: "" },
      }),
    );
    // The command body carries no parts: the chips stay for the next plain
    // prompt and a one-time note explains why (M5 review).
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByTestId("attachment-command-note")).toHaveTextContent(
      "Attachments are not sent with commands",
    );

    // The note resets on the next input; a plain prompt send still clears
    // the chips.
    fireEvent.input(input(), { target: { value: "check this" } });
    expect(screen.queryByTestId("attachment-command-note")).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.queryByText("notes.txt")).not.toBeInTheDocument());
  });

  it("an unmatched `/` message falls back to the plain prompt path", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "/does-not-exist hello" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
        body: { parts: [{ type: "text", text: "/does-not-exist hello" }] },
      }),
    );
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it("a failed command run shows the error banner and keeps the input", async () => {
    client.post.mockRejectedValueOnce(new ApiError(500, "http", "command boom", true));
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "/init" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.getByTestId("error-banner-title")).toHaveTextContent("Server error");
    // The text survives for a retry; no plain prompt was sent.
    expect(input().value).toBe("/init");
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/command`, {
      body: { command: "init", arguments: "" },
    });
  });

  it("full chain: a run command's reply renders through the SSE message flow", async () => {
    applySessionList(SERVER, [
      { ...sessionFixture(), id: "ses_abc123", slug: "happy-chat", title: "Happy chat" },
    ]);
    render(() => (
      <>
        <MessageList serverId={SERVER} sessionId="ses_abc123" />
        <PromptBox serverId={SERVER} sessionId="ses_abc123" />
      </>
    ));

    fireEvent.input(input(), { target: { value: "/init" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/ses_abc123/command`, {
        body: { command: "init", arguments: "" },
      }),
    );

    const happyChat = scenarios["happy-chat"];
    for (const step of happyChat) {
      if (step.event) applyEvent(SERVER, step.event as SseEvent);
    }

    await waitFor(() =>
      expect(screen.getByText(/Hello! I can help with that/)).toBeInTheDocument(),
    );
    expect(input()).not.toBeDisabled();
  });
});

describe("PromptBox agent selector", () => {
  const AGENTS = [
    {
      name: "build",
      description: "General-purpose coding agent",
      mode: "primary",
      color: "#E5B83C",
      permission: [],
      options: {},
    },
    {
      name: "plan",
      description: "Read-only planning agent",
      mode: "primary",
      color: "#84C1FF",
      permission: [],
      options: {},
    },
    {
      name: "architect",
      description: "Background review agent",
      mode: "subagent",
      color: "#8A9B68",
      hidden: true,
      permission: [],
      options: {},
    },
  ];

  beforeEach(() => {
    client.get.mockImplementation(async (path: string) => (path === "/agent" ? AGENTS : []));
  });

  it("shows the effective agent with its color dot and fetches the catalog once per server", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build"));
    expect(client.get).toHaveBeenCalledWith("/agent", undefined);
    expect(screen.getByTestId("agent-chip-dot")).toHaveStyle({ background: "#E5B83C" });
  });

  it("the chip opens a menu of visible agents with description and mode; hidden agents stay out", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build"));

    fireEvent.click(screen.getByTestId("agent-chip"));

    const items = screen.getAllByTestId("agent-menu-item");
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.textContent)).not.toContain("architect");
    expect(screen.getByText("Read-only planning agent")).toBeInTheDocument();
    expect(screen.getAllByText("primary").length).toBeGreaterThanOrEqual(1);
    expect(items[0]).toHaveAttribute("aria-selected", "true");
  });

  it("selecting an agent records the per-session choice and updates the chip", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build"));

    fireEvent.click(screen.getByTestId("agent-chip"));
    fireEvent.click(screen.getByText("plan"));

    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("plan"));
    expect(screen.queryByTestId("agent-menu")).not.toBeInTheDocument();
    expect(agentNameFor(SERVER, SESSION)).toBe("plan");
  });

  it("remembers the agent per session across remounts", async () => {
    const { unmount } = render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build"));
    fireEvent.click(screen.getByTestId("agent-chip"));
    fireEvent.click(screen.getByText("plan"));
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("plan"));
    unmount();

    const second = render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("plan"));
    second.unmount();

    // A session without a recorded choice falls back to the default.
    render(() => <PromptBox serverId={SERVER} sessionId="ses_other" />);
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build"));
  });

  it("Tab cycles the visible agents in the textarea and skips hidden ones", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build"));

    fireEvent.keyDown(input(), { key: "Tab" });
    expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("plan");
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build");
  });

  it("sends the selected agent in the prompt_async body", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build"));
    fireEvent.keyDown(input(), { key: "Tab" });

    fireEvent.input(input(), { target: { value: "draft the plan" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
        body: { parts: [{ type: "text", text: "draft the plan" }], agent: "plan" },
      }),
    );
  });

  it("Escape closes the agent menu", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build"));

    fireEvent.click(screen.getByTestId("agent-chip"));
    expect(screen.getByTestId("agent-menu")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("agent-chip"), { key: "Escape" });
    expect(screen.queryByTestId("agent-menu")).not.toBeInTheDocument();
  });
});

describe("PromptBox model selector", () => {
  const AGENTS = [
    {
      name: "build",
      description: "General-purpose coding agent",
      mode: "primary",
      color: "#E5B83C",
      permission: [],
      options: {},
    },
  ];
  const MODELS = {
    gpt5: {
      id: "gpt-5",
      providerID: "openai",
      name: "GPT-5",
      api: { id: "gpt-5", url: "https://example.com/v1", npm: "@ai-sdk/openai" },
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 1.25, output: 10, cache: { read: 0.625, write: 1.25 } },
      limit: { context: 400000, output: 128000 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2025-08-07",
    },
    gpt41: {
      id: "gpt-4.1",
      providerID: "openai",
      name: "GPT-4.1",
      api: { id: "gpt-4.1", url: "https://example.com/v1", npm: "@ai-sdk/openai" },
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.2, output: 1.2, cache: { read: 0.1, write: 0.2 } },
      limit: { context: 400000, output: 64000 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2025-08-07",
    },
    sonnet: {
      id: "claude-sonnet-4-5",
      providerID: "anthropic",
      name: "Claude Sonnet 4.5",
      api: { id: "claude-sonnet-4-5", url: "https://example.com/v1", npm: "@ai-sdk/anthropic" },
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 3, output: 15, cache: { read: 1.5, write: 3 } },
      limit: { context: 200000, output: 64000 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2025-09-29",
    },
  };
  const PROVIDERS = [
    {
      id: "openai",
      name: "OpenAI",
      source: "env",
      env: [],
      options: {},
      models: { "gpt-5": MODELS.gpt5, "gpt-4.1": MODELS.gpt41 },
    },
    {
      id: "anthropic",
      name: "Anthropic",
      source: "env",
      env: [],
      options: {},
      models: { "claude-sonnet-4-5": MODELS.sonnet },
    },
  ];
  const LIST = {
    all: PROVIDERS,
    default: { openai: "gpt-5" },
    connected: ["openai", "anthropic"],
  };
  const CONFIG = { providers: PROVIDERS, default: { openai: "gpt-5" } };

  beforeEach(() => {
    client.get.mockImplementation(async (path: string) => {
      if (path === "/provider") return LIST;
      if (path === "/config/providers") return CONFIG;
      if (path === "/agent") return AGENTS;
      return [];
    });
  });

  it("shows the effective model name with its provider and fetches the catalog once per server", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    await waitFor(() => expect(screen.getByTestId("model-chip-name")).toHaveTextContent("GPT-5"));
    expect(screen.getByTestId("model-chip-provider")).toHaveTextContent("OpenAI");
    expect(client.get).toHaveBeenCalledWith("/provider", undefined);
    expect(client.get).toHaveBeenCalledWith("/config/providers", undefined);
  });

  it("the chip opens the picker listing models grouped by provider", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("model-chip-name")).toHaveTextContent("GPT-5"));

    fireEvent.click(screen.getByTestId("model-chip"));

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(2));
    expect(screen.getByTestId("model-picker")).toHaveTextContent("OpenAI");
    expect(screen.getByTestId("model-picker")).toHaveTextContent("Anthropic");
    expect(screen.getByTestId("model-picker-search")).toBeInTheDocument();
  });

  it("selecting a model in the picker updates the chip and records the session choice", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("model-chip-name")).toHaveTextContent("GPT-5"));

    fireEvent.click(screen.getByTestId("model-chip"));
    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(2));
    const sonnetRow = screen
      .getAllByTestId("model-item")
      .find((item) => item.getAttribute("data-model") === "claude-sonnet-4-5");
    fireEvent.click(sonnetRow!.querySelector("[data-testid='model-item-select']")!);

    await waitFor(() =>
      expect(screen.getByTestId("model-chip-name")).toHaveTextContent("Claude Sonnet 4.5"),
    );
    expect(screen.queryByTestId("model-picker")).not.toBeInTheDocument();
    expect(activeModelFor(SERVER, SESSION)).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
    });
  });

  it("remembers the model per session across remounts", async () => {
    const { unmount } = render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("model-chip-name")).toHaveTextContent("GPT-5"));
    fireEvent.click(screen.getByTestId("model-chip"));
    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(2));
    const gpt41Row = screen
      .getAllByTestId("model-item")
      .find((item) => item.getAttribute("data-model") === "gpt-4.1");
    fireEvent.click(gpt41Row!.querySelector("[data-testid='model-item-select']")!);
    await waitFor(() => expect(screen.getByTestId("model-chip-name")).toHaveTextContent("GPT-4.1"));
    unmount();

    const second = render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("model-chip-name")).toHaveTextContent("GPT-4.1"));
    second.unmount();

    // A session without a recorded choice falls back to the default.
    render(() => <PromptBox serverId={SERVER} sessionId="ses_other" />);
    await waitFor(() => expect(screen.getByTestId("model-chip-name")).toHaveTextContent("GPT-5"));
  });

  it("sends the selected model in the prompt_async body", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("model-chip-name")).toHaveTextContent("GPT-5"));
    fireEvent.click(screen.getByTestId("model-chip"));
    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(2));
    const sonnetRow = screen
      .getAllByTestId("model-item")
      .find((item) => item.getAttribute("data-model") === "claude-sonnet-4-5");
    fireEvent.click(sonnetRow!.querySelector("[data-testid='model-item-select']")!);
    await waitFor(() =>
      expect(screen.getByTestId("model-chip-name")).toHaveTextContent("Claude Sonnet 4.5"),
    );

    fireEvent.input(input(), { target: { value: "draft the plan" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
        body: {
          parts: [{ type: "text", text: "draft the plan" }],
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
        },
      }),
    );
  });

  it("Esc closes the picker without changing the model", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("model-chip-name")).toHaveTextContent("GPT-5"));

    fireEvent.click(screen.getByTestId("model-chip"));
    await waitFor(() => expect(screen.getByTestId("model-picker")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByTestId("model-picker-close"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("model-picker")).not.toBeInTheDocument());
    expect(activeModelFor(SERVER, SESSION)).toEqual({ providerID: "openai", modelID: "gpt-5" });
  });
});

// TASK-M5-08: `@`-menu skills group and `!` shell command execution.
describe("PromptBox skill references and shell commands", () => {
  const SKILLS = [
    {
      name: "research",
      description: "Deep research workflow",
      location: "/mock/skills/research/SKILL.md",
      content: "# research\n",
    },
    {
      name: "code-review",
      description: "Pre-ship code review checklist",
      location: "/mock/skills/code-review/SKILL.md",
      content: "# code-review\n",
    },
    {
      name: "sql-analyzer",
      location: "/mock/skills/sql-analyzer/SKILL.md",
      content: "# sql-analyzer\n",
    },
  ];
  const AGENTS = [
    {
      name: "build",
      description: "General-purpose coding agent",
      mode: "primary",
      color: "#E5B83C",
      permission: [],
      options: {},
    },
  ];

  beforeEach(() => {
    client.get.mockImplementation(async (path: string) => {
      if (path === "/skill") return SKILLS;
      if (path === "/agent") return AGENTS;
      if (path === "/find/file") return ["src/services/find.ts"];
      return [];
    });
  });

  it("@ opens the menu with a filtered skills group above the file results", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "@res" } });

    await waitFor(() => expect(screen.getByTestId("prompt-at-menu")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("prompt-at-skill")).toBeInTheDocument());
    expect(client.get).toHaveBeenCalledWith("/skill", undefined);

    const skills = screen.getAllByTestId("prompt-at-skill");
    expect(skills).toHaveLength(1);
    expect(skills[0]).toHaveTextContent("research");
    expect(skills[0]).toHaveTextContent("Deep research workflow");
    // The skills group leads the list; files follow below (debounced fetch).
    await waitFor(() => expect(screen.getAllByTestId("prompt-at-item")).toHaveLength(1));
    expect(skills[0]).toHaveAttribute("aria-selected", "true");
  });

  it("renders each group header directly above its own rows", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "@res" } });
    await waitFor(() => expect(screen.getByTestId("prompt-at-skill")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId("prompt-at-item")).toHaveLength(1));

    // DOM order: Skills header -> skill rows -> Files header -> file rows
    // (the Files header must not float above the skill rows; M5 review).
    const order = Array.from(screen.getByTestId("prompt-at-menu").children).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(order).toEqual([
      "prompt-at-group-skills",
      "prompt-at-skill",
      "prompt-at-group-files",
      "prompt-at-item",
    ]);
  });

  it("the skills catalog is fetched once per mount and reused for later queries", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "@res" } });
    await waitFor(() => expect(screen.getByTestId("prompt-at-skill")).toBeInTheDocument());
    fireEvent.input(input(), { target: { value: "@research" } });
    await waitFor(() => expect(screen.getAllByTestId("prompt-at-skill")).toHaveLength(1));

    const skillCalls = client.get.mock.calls.filter(([path]) => path === "/skill");
    expect(skillCalls).toHaveLength(1);
  });

  it("Enter on a skill row inserts a plain @name reference", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "see @res" } });
    await waitFor(() => expect(screen.getAllByTestId("prompt-at-skill")).toHaveLength(1));
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(input().value).toBe("see @research");
    expect(screen.queryByTestId("prompt-at-menu")).not.toBeInTheDocument();
  });

  it("a query without skill matches hides the group but keeps the file rows", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);

    fireEvent.input(input(), { target: { value: "@zzz" } });
    await waitFor(() => expect(screen.getAllByTestId("prompt-at-item")).toHaveLength(1));

    expect(screen.queryByTestId("prompt-at-skill")).not.toBeInTheDocument();
    expect(screen.queryByText("Skills")).not.toBeInTheDocument();
  });

  it("`!` runs POST /session/{id}/shell with the effective agent, applies the reply and clears the input", async () => {
    const shellReply = {
      info: {
        id: "msg_asst_shell_1",
        sessionID: SESSION,
        role: "assistant",
        time: { created: 2 },
        modelID: "gpt-5",
        providerID: "openai",
        mode: "primary",
        agent: "build",
        path: { cwd: DEMO_DIR, root: DEMO_DIR },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
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
    };
    client.post.mockImplementation(async (path: string) =>
      path === `/session/${SESSION}/shell` ? shellReply : undefined,
    );
    render(() => (
      <>
        <MessageList serverId={SERVER} sessionId={SESSION} />
        <PromptBox serverId={SERVER} sessionId={SESSION} />
      </>
    ));
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build"));

    fireEvent.input(input(), { target: { value: "!ls" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/shell`, {
        body: { command: "ls", agent: "build" },
      }),
    );
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("");

    // The synchronous reply renders as an assistant message (no SSE).
    await waitFor(() => expect(screen.getByText(/\$ ls/)).toBeInTheDocument());
    const entry = messages[SERVER]?.[SESSION];
    expect(Object.keys(entry?.infos ?? {})).toEqual(["msg_asst_shell_1"]);
    expect(entry?.parts[entry?.order[0] ?? ""]).toMatchObject({ type: "text", text: "$ ls\nsrc" });
  });

  it("`!` carries the effective model in the shell body when a model is active", async () => {
    const MODELS = {
      gpt5: {
        id: "gpt-5",
        providerID: "openai",
        name: "GPT-5",
        api: { id: "gpt-5", url: "https://example.com/v1", npm: "@ai-sdk/openai" },
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 1.25, output: 10, cache: { read: 0.625, write: 1.25 } },
        limit: { context: 400000, output: 128000 },
        status: "active",
        options: {},
        headers: {},
        release_date: "2025-08-07",
      },
    };
    client.get.mockImplementation(async (path: string) => {
      if (path === "/skill") return SKILLS;
      if (path === "/agent") return AGENTS;
      if (path === "/provider")
        return {
          all: [
            {
              id: "openai",
              name: "OpenAI",
              source: "env",
              env: [],
              options: {},
              models: { "gpt-5": MODELS.gpt5 },
            },
          ],
          default: { openai: "gpt-5" },
          connected: ["openai"],
        };
      if (path === "/config/providers")
        return {
          providers: [
            {
              id: "openai",
              name: "OpenAI",
              source: "env",
              env: [],
              options: {},
              models: { "gpt-5": MODELS.gpt5 },
            },
          ],
          default: { openai: "gpt-5" },
        };
      return [];
    });
    client.post.mockResolvedValue({
      info: { id: "msg_asst_shell_2", sessionID: SESSION, role: "assistant", time: { created: 2 } },
      parts: [],
    });
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("model-chip-name")).toHaveTextContent("GPT-5"));

    fireEvent.input(input(), { target: { value: "!pwd" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/shell`, {
        body: {
          command: "pwd",
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-5" },
        },
      }),
    );
  });

  it("a failed shell run restores the input and shows the error banner", async () => {
    client.post.mockRejectedValueOnce(new ApiError(500, "http", "shell boom", true));
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build"));

    fireEvent.input(input(), { target: { value: "!ls" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.getByTestId("error-banner-title")).toHaveTextContent("Server error");
    // The text survives for retry; no prompt_async was sent.
    expect(input().value).toBe("!ls");
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/shell`, {
      body: { command: "ls", agent: "build" },
    });
  });

  it("a bare `!` falls back to the plain prompt path", async () => {
    render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("agent-chip-name")).toHaveTextContent("build"));

    fireEvent.input(input(), { target: { value: "!" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
        body: { parts: [{ type: "text", text: "!" }], agent: "build" },
      }),
    );
    expect(client.post).toHaveBeenCalledTimes(1);
  });
});
