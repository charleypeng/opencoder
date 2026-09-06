// L2 tests for the message history list (TASK-M2-06 / M2-09): history fetch
// on mount merged into the messages store via the batched applyMessageBatch,
// user/assistant bubble distinction with timestamps, the reasoning fold
// (collapsed by default, expand on click), tool cards in their v1 states,
// graceful skipping of unsupported part types, loading / empty / error +
// retry states, the streaming fallback for parts without message info,
// auto-scroll pause with the "New messages" jump button, the M2-09 streaming
// pipeline (virtualization of long transcripts,
// the breathing typing caret driven by the streaming indicator), a
// fixture snapshot, and the TASK-M3-06 delete failure path through the real
// list -> bubble -> actions chain (row kept, inline error in the dialog).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import MessageList from "./MessageList";
import type { SessionMessage } from "../../services/message";
import { ApiError } from "../../services/errors";
import {
  applyTextDelta,
  getServerMessages,
  resetServer as resetMessages,
  trackPendingLocalMessage,
  upsertMessage,
} from "../../stores/messages";
import {
  applySessionList,
  resetServer as resetSessions,
  setSessionStatus,
} from "../../stores/session";
import { HISTORY_PAGE_SIZE } from "./usePaginatedMessages";

import historyFixtureJson from "../../../tests/fixtures/session.messages.json";
import allPartsFixtureJson from "../../../tests/fixtures/message.stream.all-parts.json";
import longHistoryFixtureJson from "../../../tests/fixtures/session.messages.long.json";

const historyFixture = historyFixtureJson as unknown as SessionMessage[];
const allPartsFixture = allPartsFixtureJson as unknown as SessionMessage;
const longHistoryFixture = longHistoryFixtureJson as unknown as SessionMessage[];

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-msg";
const SESSION = "ses_1";

// ResizeObserver stub: the virtual list registers a callback per mounted
// row; tests fire them manually to simulate a row's measured height
// changing (as async code-fence hydration does in the real WebView).
const observers: Array<{ cb: () => void; target?: Element }> = [];
const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  getApiClientMock.mockReset();
  mockClient([]);
  observers.length = 0;
  globalThis.ResizeObserver = class {
    private readonly entry: { cb: () => void; target?: Element };

    constructor(cb: () => void) {
      this.entry = { cb };
      observers.push(this.entry);
    }
    observe(target: Element) {
      this.entry.target = target;
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  resetMessages(SERVER);
  resetSessions(SERVER);
  globalThis.ResizeObserver = originalResizeObserver;
});

function mockClient(history: SessionMessage[]) {
  const client = {
    get: vi.fn(async () => history),
    post: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

/** Builds `count` single-part user/assistant messages for long lists. */
function syntheticHistory(count: number): SessionMessage[] {
  const out: SessionMessage[] = [];
  for (let i = 1; i <= count; i++) {
    const id = `msg_s${i}`;
    out.push({
      info: {
        id,
        sessionID: SESSION,
        role: i % 2 === 1 ? "user" : "assistant",
        time: { created: i * 1000 },
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5" },
      } as SessionMessage["info"],
      parts: [
        {
          id: `prt_s${i}`,
          sessionID: SESSION,
          messageID: id,
          type: "text",
          text: `Synthetic message ${i}`,
        },
      ],
    });
  }
  return out;
}

/** A long transcript whose latest page contains OpenCode's compaction marker. */
function compactedHistory(count: number): SessionMessage[] {
  const history = syntheticHistory(count);
  const marker = history[count - 20];
  marker.info = { ...marker.info, role: "user" } as SessionMessage["info"];
  marker.parts = [
    {
      id: `prt_compaction_${count - 20}`,
      sessionID: SESSION,
      messageID: marker.info.id,
      type: "compaction",
      auto: true,
    },
  ];
  return history;
}

/**
 * TASK-M3-05: a client mock that serves a fixed chronological message list
 * with real pagination semantics (limit = most recent page, before = the
 * strictly older page, unknown cursor = empty page), like the mock server.
 * `includeCursor` makes the server echo the cursor message back on paged
 * responses to exercise the client-side dedupe.
 */
type GetCall = (
  path: string,
  options?: { query?: Record<string, unknown> },
) => Promise<SessionMessage[]>;

function paginatedClientFrom(messages: SessionMessage[], includeCursor = false) {
  const client = {
    get: vi.fn<GetCall>(() => Promise.resolve([])),
    post: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  client.get.mockImplementation(async (_path, options) => {
    const query = (options?.query ?? {}) as { limit?: number; before?: string };
    const limit = typeof query.limit === "number" ? query.limit : messages.length;
    let window = messages;
    if (query.before !== undefined) {
      const index = messages.findIndex((m) => m.info.id === query.before);
      window = index === -1 ? [] : messages.slice(0, includeCursor ? index + 1 : index);
    }
    return window.slice(-limit);
  });
  return client;
}

function renderList(serverId = SERVER, sessionId = SESSION) {
  return render(() => <MessageList serverId={serverId} sessionId={sessionId} />);
}

/** Renders the list with the fixture history and waits for the bubbles. */
async function renderHistory() {
  mockClient(historyFixture);
  renderList();
  await waitFor(() => expect(screen.getByTestId("message-msg_m4")).toBeInTheDocument());
}

describe("MessageList", () => {
  it("renders user and assistant bubbles with timestamps", async () => {
    await renderHistory();

    const user = screen.getByTestId("message-msg_m1");
    const assistant = screen.getByTestId("message-msg_m2");
    expect(user).toHaveAttribute("data-role", "user");
    expect(assistant).toHaveAttribute("data-role", "assistant");
    expect(user).toHaveTextContent("Add a login flow with password-based auth.");
    expect(assistant).toHaveTextContent("Let me check the existing project structure first.");
    expect(screen.getAllByTestId("message-time")).toHaveLength(4);
  });

  it("keeps the process fold collapsed and expands it on click", async () => {
    await renderHistory();

    const columns = screen.getAllByTestId("chat-reading-column");
    expect(columns).not.toHaveLength(0);
    for (const column of columns) {
      expect(column).toHaveClass("max-w-[58rem]");
    }

    const assistant = screen.getByTestId("message-msg_m2");
    const toggle = within(assistant).getByTestId("process-fold-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(assistant).getByTestId("process-fold-body")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(assistant).getByTestId("thought-details-toggle"));
    expect(within(assistant).getByTestId("reasoning-body")).toHaveTextContent(
      "The client needs a login form",
    );
  });

  it("renders tool cards with running and completed states and expandable payloads", async () => {
    await renderHistory();

    const assistant = screen.getByTestId("message-msg_m2");
    // Tool cards live inside the process fold below the answer; expand it
    // first (chat refactor).
    fireEvent.click(within(assistant).getByTestId("process-fold-toggle"));
    // The running/completed payloads share a callID, so the trace presents
    // one lifecycle row using the latest state.
    const tools = within(assistant).getAllByTestId("tool-part");
    expect(tools).toHaveLength(1);
    const completed = tools[0];
    expect(completed).toHaveAttribute("data-status", "completed");
    expect(within(completed).getByTestId("tool-summary")).toHaveTextContent("Ran ls src");
    expect(within(completed).getByTestId("tool-status-label")).toHaveTextContent("bash completed");

    fireEvent.click(within(completed).getByTestId("tool-toggle"));
    const terminal = within(completed).getByTestId("tool-terminal");
    expect(terminal).toBeInTheDocument();
    expect(terminal).toHaveTextContent(/ls src/);
    expect(terminal).toHaveTextContent(/auth/);
  });

  it("renders every supported part from the all-parts fixture", async () => {
    mockClient([allPartsFixture]);
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-msg_m2")).toBeInTheDocument());

    // text / reasoning / tool plus the subtask / agent hierarchy.
    expect(
      screen.getByText("Let me check the existing project structure first."),
    ).toBeInTheDocument();
    // Reasoning + tool calls now live in ONE collapsed process fold below
    // the answer (chat refactor); the tool cards stay mounted inside it.
    expect(screen.getByTestId("process-fold")).toBeInTheDocument();
    expect(screen.getByTestId("process-fold-toggle")).toHaveAttribute("aria-expanded", "false");
    // Nine tool parts contain one running/completed pair for the same call.
    expect(screen.getAllByTestId("tool-part")).toHaveLength(8);
    // Step boundary parts are not rendered (chat refactor).
    expect(screen.queryAllByTestId("step-start-part")).toHaveLength(0);
    expect(screen.queryAllByTestId("step-finish-part")).toHaveLength(0);
    // Subtask/agent parts are owned by TaskPanel, not the transcript.
    expect(screen.queryByTestId("subtask-part")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-part")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("process-fold-toggle"));
    for (const toggle of screen.getAllByTestId("thought-details-toggle")) {
      fireEvent.click(toggle);
    }
    expect(screen.getByTestId("retry-part")).toHaveTextContent("Retrying (attempt 2)");
    expect(screen.getByTestId("compaction-part")).toHaveTextContent("Context compacted");
  });

  it("shows the empty state when the session has no messages", async () => {
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-empty")).toBeInTheDocument());
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
  });

  it("shows an error banner with retry that recovers the history", async () => {
    const client = mockClient(historyFixture);
    client.get.mockRejectedValueOnce(new ApiError(500, "http", "boom", true));
    renderList();

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.queryByTestId("message-empty")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("message-retry"));
    await waitFor(() => expect(screen.getByTestId("message-msg_m1")).toBeInTheDocument());
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });

  it("keeps the row and shows the inline error when a message delete fails (TASK-M3-06)", async () => {
    // Through the real list -> bubble -> actions chain: the standalone
    // MessageActions test cannot see this path, where the DELETE failure
    // must surface while the message row stays in the transcript.
    const client = mockClient(historyFixture);
    client.delete.mockRejectedValueOnce({
      status: 409,
      code: "http",
      message: "busy",
      retriable: false,
    });
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-msg_m1")).toBeInTheDocument());

    const user = screen.getByTestId("message-msg_m1");
    fireEvent.click(within(user).getByTestId("message-actions"));
    await waitFor(() => expect(screen.getByTestId("message-action-delete")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("message-action-delete"));
    await waitFor(() => expect(screen.getByTestId("delete-message-dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("delete-message-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-message-error")).toHaveTextContent("busy"),
    );
    // The row survived the failed round-trip (no silent rollback) and the
    // dialog is still open so the user can retry or cancel.
    expect(screen.getByTestId("message-msg_m1")).toHaveTextContent(
      "Add a login flow with password-based auth.",
    );
    expect(screen.getByTestId("delete-message-dialog")).toBeInTheDocument();
    expect(screen.getAllByTestId("message-time")).toHaveLength(4);
  });

  it("renders streamed parts without message info as an assistant fallback", async () => {
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-empty")).toBeInTheDocument());

    applyTextDelta(SERVER, SESSION, {
      messageID: "msg_stream",
      partID: "prt_stream",
      field: "text",
      delta: "Hello stream",
    });
    const bubble = await waitFor(() => screen.getByTestId("message-msg_stream"));
    expect(bubble).toHaveAttribute("data-role", "assistant");
    expect(within(bubble).getByText("Hello stream")).toBeInTheDocument();
    expect(within(bubble).queryByTestId("message-time")).not.toBeInTheDocument();
  });

  it("pauses auto-scroll on scroll-up and offers a New messages jump button", async () => {
    mockClient(syntheticHistory(60));
    renderList();
    const scroll = screen.getByTestId("message-list-scroll");
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scroll, "scrollTop", { configurable: true, value: 5760, writable: true });
    await waitFor(() => expect(screen.getByTestId("message-msg_s60")).toBeInTheDocument());
    // First pass measures the viewport (0 in jsdom until defined); the
    // follow effect re-pins to 60*96 - 400. Then simulate the scroll-up.
    fireEvent.scroll(scroll);
    scroll.scrollTop = 2000;
    fireEvent.scroll(scroll);
    expect(screen.queryByTestId("message-jump")).not.toBeInTheDocument();

    // Content arriving while paused flags the jump button.
    applyTextDelta(SERVER, SESSION, {
      messageID: "msg_s60",
      partID: "prt_s60",
      field: "text",
      delta: " extra reply",
    });
    await waitFor(() => expect(screen.getByTestId("message-jump")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("message-jump"));
    await waitFor(() => expect(screen.queryByTestId("message-jump")).not.toBeInTheDocument());
    // Jump anchors the last row to the viewport bottom (60 rows x 96px).
    expect(scroll.scrollTop).toBe(60 * 96 - 400);
  });

  it("virtualizes long transcripts to a constant number of mounted rows", async () => {
    mockClient(syntheticHistory(300));
    renderList();
    const scroll = screen.getByTestId("message-list-scroll");
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(scroll, "scrollTop", {
      configurable: true,
      value: 28800,
      writable: true,
    });
    // The history load auto-follows to the bottom (last row mounted).
    await waitFor(() => expect(screen.getByTestId("message-msg_s300")).toBeInTheDocument());
    expect(document.querySelectorAll("[data-virtual-row]").length).toBeLessThan(30);

    // Measure pass (viewport 0 until defined) re-pins to the bottom; then
    // scroll to the top: only the head rows stay mounted.
    fireEvent.scroll(scroll);
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);
    expect(screen.getByTestId("message-msg_s1")).toBeInTheDocument();
    expect(screen.queryByTestId("message-msg_s300")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-virtual-row]").length).toBeLessThan(30);

    // Middle of the transcript: neither end is mounted.
    scroll.scrollTop = 14400;
    fireEvent.scroll(scroll);
    expect(screen.queryByTestId("message-msg_s1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("message-msg_s300")).not.toBeInTheDocument();

    // Bottom again.
    scroll.scrollTop = 300 * 96 - 300;
    fireEvent.scroll(scroll);
    expect(screen.getByTestId("message-msg_s300")).toBeInTheDocument();
    expect(screen.queryByTestId("message-msg_s1")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-virtual-row]").length).toBeLessThan(30);
  });

  it("re-measures a late-sized chat pane without requiring a user scroll", async () => {
    mockClient(syntheticHistory(300));
    renderList();
    const scroll = screen.getByTestId("message-list-scroll");
    let viewport = 0;
    let scrollTop = 0;
    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      get: () => viewport,
    });
    Object.defineProperty(scroll, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = Number(value);
      },
    });

    await waitFor(() => expect(screen.getByTestId("message-msg_s1")).toBeInTheDocument());
    const viewportObserver = observers.find((observer) => observer.target === scroll);
    expect(viewportObserver).toBeDefined();

    viewport = 400;
    viewportObserver?.cb();

    await waitFor(() => expect(screen.getByTestId("message-msg_s300")).toBeInTheDocument());
    expect(scrollTop).toBe(300 * 96 - 400);
  });

  it("keeps the top edge free of a redundant progress bar while the session is busy", async () => {
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-empty")).toBeInTheDocument());
    setSessionStatus(SERVER, SESSION, { type: "busy" });
    expect(screen.queryByTestId("streaming-progress")).not.toBeInTheDocument();
  });

  it("shows an immediate in-transcript work state before the first model event", async () => {
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-empty")).toBeInTheDocument());

    setSessionStatus(SERVER, SESSION, { type: "busy" });
    const waiting = screen.getByTestId("agent-working");
    expect(waiting).toHaveTextContent("Processing for 0s");
    expect(waiting).toHaveTextContent("Waiting for model response");
    expect(screen.queryByTestId("message-empty")).not.toBeInTheDocument();

    setSessionStatus(SERVER, SESSION, { type: "idle" });
    expect(screen.queryByTestId("agent-working")).not.toBeInTheDocument();
  });

  it("shows the work state from the optimistic send before busy SSE arrives", async () => {
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-empty")).toBeInTheDocument());

    trackPendingLocalMessage(SERVER, SESSION, "local-1");
    upsertMessage(SERVER, SESSION, {
      id: "local-1",
      sessionID: SESSION,
      role: "user",
      time: { created: 1000 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
    });
    applyTextDelta(SERVER, SESSION, {
      messageID: "local-1",
      partID: "local-part-1",
      field: "text",
      delta: "Start working",
    });

    expect(screen.getByTestId("agent-working")).toHaveTextContent("Waiting for model response");
  });

  it("renders consecutive assistant steps as one task-level run", async () => {
    const runHistory: SessionMessage[] = [
      {
        info: {
          id: "msg_user_run",
          sessionID: SESSION,
          role: "user",
          time: { created: 1000 },
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-5" },
          summary: {
            diffs: [{ file: "src/chat.tsx", additions: 7, deletions: 2, status: "modified" }],
          },
        },
        parts: [
          {
            id: "prt_user_run",
            sessionID: SESSION,
            messageID: "msg_user_run",
            type: "text",
            text: "Improve the chat",
          },
        ],
      },
      {
        info: {
          id: "msg_step_run",
          sessionID: SESSION,
          role: "assistant",
          time: { created: 2000, completed: 3000 },
          parentID: "msg_user_run",
          modelID: "gpt-5",
          providerID: "openai",
          mode: "primary",
          agent: "build",
          path: { cwd: "/project", root: "/project" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [
          {
            id: "prt_step_run",
            sessionID: SESSION,
            messageID: "msg_step_run",
            type: "text",
            text: "I am inspecting the message flow.",
          },
          {
            id: "prt_command_run",
            sessionID: SESSION,
            messageID: "msg_step_run",
            type: "tool",
            callID: "call_test",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "pnpm test" } as never,
              output: "ok",
              title: "bash",
              metadata: {},
              time: { start: 2200, end: 2600 },
            },
          },
        ],
      },
      {
        info: {
          id: "msg_final_run",
          sessionID: SESSION,
          role: "assistant",
          time: { created: 4000, completed: 5000 },
          parentID: "msg_user_run",
          modelID: "gpt-5",
          providerID: "openai",
          mode: "primary",
          agent: "build",
          path: { cwd: "/project", root: "/project" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [
          {
            id: "prt_final_run",
            sessionID: SESSION,
            messageID: "msg_final_run",
            type: "text",
            text: "The chat flow is improved.",
          },
        ],
      },
    ];
    mockClient(runHistory);
    renderList();

    const run = await waitFor(() => screen.getByTestId("message-msg_final_run"));
    expect(screen.queryByTestId("message-msg_step_run")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-label")).not.toBeInTheDocument();
    expect(run).toHaveTextContent("The chat flow is improved.");
    expect(within(run).getByTestId("process-fold-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(run).getByTestId("run-files-toggle")).toHaveTextContent("1 changed file");

    fireEvent.click(within(run).getByTestId("process-fold-toggle"));
    expect(run).toHaveTextContent("I am inspecting the message flow.");
  });

  it("shows the breathing typing caret on the streaming message while deltas flow", async () => {
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-empty")).toBeInTheDocument());

    vi.useFakeTimers();
    try {
      setSessionStatus(SERVER, SESSION, { type: "busy" });
      applyTextDelta(SERVER, SESSION, {
        messageID: "msg_stream",
        partID: "prt_stream",
        field: "text",
        delta: "streaming",
      });

      const bubble = screen.getByTestId("message-msg_stream");
      const caret = within(bubble).getByTestId("typing-cursor");
      // The caret lives inside the last markdown paragraph, i.e. inline at
      // the end of the last rendered token.
      expect(caret.closest('[data-testid="markdown-text"]')).not.toBeNull();

      // Deltas keep the caret in place (re-appended after each re-render).
      applyTextDelta(SERVER, SESSION, {
        messageID: "msg_stream",
        partID: "prt_stream",
        field: "text",
        delta: " more",
      });
      expect(
        within(screen.getByTestId("message-msg_stream")).getByTestId("typing-cursor"),
      ).toBeInTheDocument();

      // The 5s streaming window closes without new deltas: caret disappears.
      vi.advanceTimersByTime(6000);
      expect(
        within(screen.getByTestId("message-msg_stream")).queryByTestId("typing-cursor"),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("matches the fixture history snapshot", async () => {
    const timeSpy = vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("10:26");
    // The running tool card ticks its elapsed time from Date.now(); pin the
    // clock so the snapshot stays deterministic (start 1750000014000 -> 500ms).
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1750000014500);
    mockClient(historyFixture);
    const { container } = renderList();
    await waitFor(() => expect(screen.getByTestId("message-msg_m4")).toBeInTheDocument());
    // Kobalte assigns global counter-based ids to dropdown triggers; strip
    // them so the snapshot stays stable no matter which tests mounted a menu
    // before this one.
    container
      .querySelectorAll<HTMLElement>("[id^='dropdownmenu-cl-']")
      .forEach((el) => el.removeAttribute("id"));
    container
      .querySelectorAll<HTMLElement>("[data-testid='process-fold-toggle']")
      .forEach((el) => el.removeAttribute("aria-controls"));
    container
      .querySelectorAll<HTMLElement>("[data-testid='process-fold-body']")
      .forEach((el) => el.removeAttribute("id"));
    // Conditional Solid children can leave indentation-only text nodes.
    // Remove them so snapshots capture UI structure instead of formatter
    // whitespace (and never introduce trailing-space lines).
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const whitespaceNodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.textContent?.trim() === "") whitespaceNodes.push(node);
    }
    whitespaceNodes.forEach((node) => node.remove());
    expect(container).toMatchSnapshot();
    timeSpy.mockRestore();
    nowSpy.mockRestore();
  });
});

describe("MessageList pagination (TASK-M3-05)", () => {
  function storeEntry() {
    return getServerMessages(SERVER)[SESSION];
  }

  function topReach(scroll: HTMLElement) {
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 400 });
    // In jsdom the virtualizer can only learn the viewport from a scroll
    // event; that first event re-pins the follow (measuring the viewport
    // triggers the auto-scroll effect), so a second event from the top is
    // the one that fires the earlier-page load — same as the existing
    // virtual-list tests, which re-set scrollTop after the first scroll.
    Object.defineProperty(scroll, "scrollTop", { configurable: true, value: 0, writable: true });
    fireEvent.scroll(scroll);
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);
  }

  it("fetches only the most recent page on mount and merges it chronologically", async () => {
    const client = paginatedClientFrom(longHistoryFixture);
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-msg_l120")).toBeInTheDocument());

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get.mock.calls[0][1]?.query).toEqual({ limit: HISTORY_PAGE_SIZE });
    const store = storeEntry();
    expect(Object.keys(store.infos)).toHaveLength(HISTORY_PAGE_SIZE);
    expect(store.infos["msg_l71"]).toBeDefined();
    expect(store.infos["msg_l70"]).toBeUndefined();
    // The page renders oldest-first inside itself.
    expect(Object.keys(store.messageParts)[0]).toBe("msg_l71");
    const pageKeys = Object.keys(store.messageParts);
    expect(pageKeys[pageKeys.length - 1]).toBe("msg_l120");
  });

  it("restores all earlier pages after reloading a compacted conversation", async () => {
    const history = compactedHistory(120);
    const client = paginatedClientFrom(history);
    renderList();

    await waitFor(() => expect(Object.keys(storeEntry().infos)).toHaveLength(120));
    expect(client.get).toHaveBeenCalledTimes(3);
    expect(client.get.mock.calls[0][1]?.query).toEqual({ limit: HISTORY_PAGE_SIZE });
    expect(client.get.mock.calls[1][1]?.query).toEqual({
      limit: HISTORY_PAGE_SIZE,
      before: "msg_s71",
    });
    expect(client.get.mock.calls[2][1]?.query).toEqual({
      limit: HISTORY_PAGE_SIZE,
      before: "msg_s21",
    });
    expect(storeEntry().infos["msg_s1"]).toBeDefined();
    expect(storeEntry().infos["msg_s120"]).toBeDefined();
  });

  it("loads older pages on top-reach with scroll preservation and no jump button", async () => {
    const client = paginatedClientFrom(longHistoryFixture);
    renderList();
    const scroll = screen.getByTestId("message-list-scroll");
    await waitFor(() => expect(screen.getByTestId("message-msg_l120")).toBeInTheDocument());

    topReach(scroll);
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
    expect(client.get.mock.calls[1][1]?.query).toEqual({
      limit: HISTORY_PAGE_SIZE,
      before: "msg_l71",
    });

    // The older page was PREPENDED: 100 messages, msg_l21..msg_l70 new.
    await waitFor(() => expect(Object.keys(storeEntry().infos)).toHaveLength(100));
    expect(Object.keys(storeEntry().messageParts)[0]).toBe("msg_l21");
    expect(storeEntry().infos["msg_l70"]).toBeDefined();

    // Scroll position preserved: scrollTop grew by exactly the inserted rows
    // (50 rows x 96px estimate in jsdom), so the viewport stays anchored on
    // the previously visible content and nothing jumps.
    await waitFor(() => expect(scroll.scrollTop).toBe(50 * 96));
    expect(screen.getByTestId("message-msg_l71")).toBeInTheDocument();
    // A prepended page must not flag the "New messages" jump button.
    expect(screen.queryByTestId("message-jump")).not.toBeInTheDocument();
  });

  it("shows the loading indicator and never double-requests while a page is in flight", async () => {
    let release: (page: SessionMessage[]) => void = () => {};
    const client = {
      get: vi.fn<GetCall>(() => Promise.resolve([])),
      post: vi.fn(async () => undefined),
      patch: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    getApiClientMock.mockReturnValue(client);
    client.get.mockImplementation(async (_path, options) => {
      const query = (options?.query ?? {}) as { before?: string };
      if (query.before === undefined) return syntheticHistory(120).slice(-HISTORY_PAGE_SIZE);
      return new Promise<SessionMessage[]>((resolve) => {
        release = resolve;
      });
    });
    renderList();
    const scroll = screen.getByTestId("message-list-scroll");
    await waitFor(() => expect(screen.getByTestId("message-msg_s120")).toBeInTheDocument());

    topReach(scroll);
    // More scroll events while the page is in flight: still one request.
    fireEvent.scroll(scroll);
    fireEvent.scroll(scroll);
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("message-loading-earlier")).toBeInTheDocument();

    release(syntheticHistory(120).slice(0, HISTORY_PAGE_SIZE));
    await waitFor(() =>
      expect(screen.queryByTestId("message-loading-earlier")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(Object.keys(storeEntry().infos)).toHaveLength(100));
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it("does not request older pages when the first page is short", async () => {
    const client = paginatedClientFrom(historyFixture);
    renderList();
    const scroll = screen.getByTestId("message-list-scroll");
    await waitFor(() => expect(screen.getByTestId("message-msg_m4")).toBeInTheDocument());

    topReach(scroll);
    fireEvent.scroll(scroll);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("message-loading-earlier")).not.toBeInTheDocument();
  });

  it("stops paging when the server ignores the before cursor (replay detection)", async () => {
    const client = paginatedClientFrom(syntheticHistory(120));
    const recent = syntheticHistory(120).slice(-HISTORY_PAGE_SIZE);
    client.get.mockImplementation(async () => recent);
    renderList();
    const scroll = screen.getByTestId("message-list-scroll");
    await waitFor(() => expect(screen.getByTestId("message-msg_s120")).toBeInTheDocument());

    topReach(scroll);
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
    // The replayed page adds nothing and hasMore flips false.
    await waitFor(() => expect(Object.keys(storeEntry().infos)).toHaveLength(HISTORY_PAGE_SIZE));
    fireEvent.scroll(scroll);
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it("dedupes pages that overlap the cursor message", async () => {
    const client = paginatedClientFrom(syntheticHistory(120), true);
    renderList();
    const scroll = screen.getByTestId("message-list-scroll");
    await waitFor(() => expect(screen.getByTestId("message-msg_s120")).toBeInTheDocument());

    topReach(scroll);
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const store = storeEntry();
      // 50 initial + 49 new: the cursor message msg_s71 was already known.
      expect(Object.keys(store.infos)).toHaveLength(99);
      expect(store.order).toHaveLength(new Set(store.order).size);
    });
  });

  it("walks a 1000+ message transcript in segments without jump or duplicates", async () => {
    const client = paginatedClientFrom(syntheticHistory(1000));
    renderList();
    const scroll = screen.getByTestId("message-list-scroll");
    await waitFor(() => expect(screen.getByTestId("message-msg_s1000")).toBeInTheDocument());

    for (let page = 2; page <= 20; page++) {
      topReach(scroll);
      await waitFor(() => expect(client.get.mock.calls.length).toBe(page));
      await waitFor(() => expect(Object.keys(storeEntry().infos)).toHaveLength(page * 50));
      // No jump: the viewport stays anchored on the previously visible rows.
      await waitFor(() => expect(scroll.scrollTop).toBe(50 * 96));
    }

    const store = storeEntry();
    expect(Object.keys(store.infos)).toHaveLength(1000);
    expect(store.order).toHaveLength(1000);
    expect(new Set(Object.keys(store.infos)).size).toBe(1000);
    expect(Object.keys(store.messageParts)[0]).toBe("msg_s1");
    const keys = Object.keys(store.messageParts);
    expect(keys[keys.length - 1]).toBe("msg_s1000");

    // The last page came back full, so one probe request lands the empty
    // page and hasMore flips false — further top-reach is a no-op.
    topReach(scroll);
    await waitFor(() => expect(client.get.mock.calls.length).toBe(21));
    expect(Object.keys(storeEntry().infos)).toHaveLength(1000);
    fireEvent.scroll(scroll);
    expect(client.get.mock.calls.length).toBe(21);
  }, 15000);
});

describe("MessageList revert state (TASK-M6-04)", () => {
  const REVERTED_SESSION = {
    id: SESSION,
    slug: SESSION,
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: SESSION,
    version: "1.18.11",
    time: { created: 1, updated: 1 },
    revert: { messageID: "msg_m2" },
  } as import("../../services/session").Session;

  it("shows the reverted bar and grays the messages after the revert point", async () => {
    applySessionList(SERVER, [REVERTED_SESSION]);
    await renderHistory();

    const bar = screen.getByTestId("reverted-bar");
    expect(bar).toHaveTextContent("Reverted");
    expect(within(bar).getByTestId("unrevert")).toBeInTheDocument();

    // The revert point itself stays active; later messages are grayed (the
    // flag lives on the row wrapper, not the bubble itself).
    const revertedOf = (id: string) =>
      screen.getByTestId(`message-${id}`).closest("[data-reverted]") as HTMLElement;
    expect(revertedOf("msg_m1")).toHaveAttribute("data-reverted", "false");
    expect(revertedOf("msg_m2")).toHaveAttribute("data-reverted", "false");
    expect(revertedOf("msg_m3")).toHaveAttribute("data-reverted", "true");
    expect(revertedOf("msg_m4")).toHaveAttribute("data-reverted", "true");
  });

  it("hides the bar when the session has no revert marker", async () => {
    applySessionList(SERVER, [REVERTED_SESSION]);
    await renderHistory();

    // The store's revert marker is the only source: clearing it removes the
    // bar and un-grays every message (revert + unrevert both land here via
    // upsertSession with the server's updated session).
    applySessionList(SERVER, [{ ...REVERTED_SESSION, revert: undefined }]);
    await waitFor(() => expect(screen.queryByTestId("reverted-bar")).not.toBeInTheDocument());
    const rowEl = screen.getByTestId("message-msg_m4").closest("[data-reverted]");
    expect(rowEl).toHaveAttribute("data-reverted", "false");
  });

  it("calls onUnrevert when the one-click Unrevert button is pressed", async () => {
    applySessionList(SERVER, [REVERTED_SESSION]);
    mockClient(historyFixture);
    let unreverted = 0;
    render(() => (
      <MessageList
        serverId={SERVER}
        sessionId={SESSION}
        onUnrevert={() => void (unreverted += 1)}
      />
    ));
    await waitFor(() => expect(screen.getByTestId("reverted-bar")).toBeInTheDocument());

    fireEvent.click(within(screen.getByTestId("reverted-bar")).getByTestId("unrevert"));
    expect(unreverted).toBe(1);
  });

  it("keeps row DOM alive when a measurement re-positions it (keyed rows)", async () => {
    // Regression for the overlap/flicker bug: an unkeyed For re-created the
    // row subtree whenever a measured height changed (the code-fence
    // placeholder shrank and grew in a ResizeObserver feedback loop, and
    // rows rendered on top of each other). Rows must be keyed by message id
    // so a re-position only moves style.top and the bubble DOM survives.
    mockClient(historyFixture);
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-msg_m4")).toBeInTheDocument());

    const rowOf = (id: string) =>
      screen.getByTestId(`message-${id}`).closest("[data-virtual-row]") as HTMLElement;
    const first = rowOf("msg_m1");
    const last = rowOf("msg_m4");
    const lastTop = last.style.top;

    // Simulate async Shiki hydration growing a middle row: stub its
    // measured height and fire the ResizeObserver callback the virtual list
    // registered. The keyed list must MOVE the rows below it (style.top
    // changes) without replacing any row DOM — replacing it would drop the
    // hydrated code fences and restart the placeholder loop.
    const middle = rowOf("msg_m2");
    Object.defineProperty(middle, "offsetHeight", { configurable: true, value: 400 });
    for (const { cb } of observers) cb();

    await waitFor(() => {
      // The row below the grown one moved down (its style.top changed)…
      expect(rowOf("msg_m3").style.top).not.toBe("");
      // …and every message node is the SAME DOM node as before the
      // re-position: keyed rows are moved, not rebuilt.
      expect(rowOf("msg_m1")).toBe(first);
      expect(rowOf("msg_m2")).toBe(middle);
      expect(rowOf("msg_m4")).toBe(last);
      expect(rowOf("msg_m4").style.top).not.toBe(lastTop);
    });
  });
});
