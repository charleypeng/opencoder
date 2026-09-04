// L2 tests for the message bubble (TASK-M2-09): per-message store
// subscription — a delta on one part re-renders ONLY that part row, leaving
// sibling parts' DOM untouched (the M2-06 list regrouped and re-rendered
// every bubble on any mutation); the assistant role fallback for streamed
// parts without message info; the breathing typing caret mounted on the
// streaming text part while `typing`, and removed when it flips off.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import MessageBubble from "./MessageBubble";
import {
  applyPartDelta,
  applyTextDelta,
  messages,
  resetServer,
  upsertMessage,
} from "../../stores/messages";
import type { Message, Part } from "../../stores/messages";
import allPartsFixtureJson from "../../../tests/fixtures/message.stream.all-parts.json";
import { clearActivityViewState } from "./activity/activityViewState";

const SERVER = "srv-bubble";
const SESSION = "ses_bubble_1";

function userMessage(id: string): Message {
  return {
    id,
    sessionID: SESSION,
    role: "user",
    time: { created: 1000 },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5" },
  } as Message;
}

function assistantMessage(id: string, parentID: string, created = 2000): Message {
  return {
    id,
    sessionID: SESSION,
    role: "assistant",
    time: { created, completed: created + 1000 },
    parentID,
    modelID: "gpt-5",
    providerID: "openai",
    mode: "primary",
    agent: "build",
    path: { cwd: "/project", root: "/project" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function seedMessage(messageID: string, partIds: string[], texts: string[]): void {
  upsertMessage(SERVER, SESSION, userMessage(messageID));
  partIds.forEach((id, index) => {
    applyTextDelta(SERVER, SESSION, {
      messageID,
      partID: id,
      field: "text",
      delta: texts[index] ?? "",
    });
  });
}

beforeEach(() => {
  resetServer(SERVER);
  clearActivityViewState();
});

afterEach(() => {
  resetServer(SERVER);
  clearActivityViewState();
});

describe("MessageBubble", () => {
  it("renders the message's own parts only", async () => {
    seedMessage("msg_a", ["prt_1", "prt_2"], ["hello one", "hello two"]);
    seedMessage("msg_b", ["prt_3"], ["other message"]);
    render(() => (
      <MessageBubble
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_a"
        partIds={["prt_1", "prt_2"]}
      />
    ));

    const bubble = screen.getByTestId("message-msg_a");
    expect(bubble).toHaveTextContent("hello one");
    expect(bubble).toHaveTextContent("hello two");
    expect(bubble).not.toHaveTextContent("other message");
    expect(screen.queryByTestId("message-msg_b")).not.toBeInTheDocument();
  });

  it("falls back to the assistant role for streamed parts without info", async () => {
    applyTextDelta(SERVER, SESSION, {
      messageID: "msg_stream",
      partID: "prt_stream",
      field: "text",
      delta: "streaming…",
    });
    render(() => (
      <MessageBubble
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_stream"
        partIds={["prt_stream"]}
      />
    ));

    const bubble = screen.getByTestId("message-msg_stream");
    expect(bubble).toHaveAttribute("data-role", "assistant");
    expect(bubble).toHaveTextContent("streaming…");
    expect(screen.queryByTestId("message-time")).not.toBeInTheDocument();
  });

  it("re-renders only the mutated part row: sibling DOM nodes are untouched", async () => {
    seedMessage("msg_a", ["prt_1", "prt_2"], ["part one", "part two"]);
    render(() => (
      <MessageBubble
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_a"
        partIds={["prt_1", "prt_2"]}
      />
    ));

    const bubble = screen.getByTestId("message-msg_a");
    const partOne = withinMarkdown(bubble, "part one");
    const partTwo = withinMarkdown(bubble, "part two");
    expect(partOne).not.toBeNull();
    expect(partTwo).not.toBeNull();

    // Stream a delta into part 2: part 1's DOM node must stay the same
    // element (fine-grained update — the bubble did not rebuild).
    applyTextDelta(SERVER, SESSION, {
      messageID: "msg_a",
      partID: "prt_2",
      field: "text",
      delta: " +",
    });
    expect(withinMarkdown(bubble, "part one")).toBe(partOne);
    expect(withinMarkdown(bubble, "part two +")).not.toBeNull();
  });

  it("shows the typing caret on the last text part while typing and removes it on flip", async () => {
    seedMessage("msg_a", ["prt_1", "prt_2"], ["first", "second"]);
    const [typing, setTyping] = createSignal(true);
    render(() => (
      <MessageBubble
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_a"
        partIds={["prt_1", "prt_2"]}
        typing={typing()}
      />
    ));

    const bubble = screen.getByTestId("message-msg_a");
    const caret = bubble.querySelector('[data-testid="typing-cursor"]');
    expect(caret).not.toBeNull();
    // The caret sits inside the LAST text part's markdown container.
    const markdownHosts = bubble.querySelectorAll('[data-testid="markdown-text"]');
    expect(markdownHosts.length).toBe(2);
    expect(markdownHosts[1].contains(caret)).toBe(true);

    setTyping(false);
    await waitFor(() => expect(bubble.querySelector('[data-testid="typing-cursor"]')).toBeNull());
  });

  it("hides subtask and agent parts from the chat transcript", async () => {
    for (const partId of [
      "prt_p3",
      "prt_p6",
      "prt_p10",
      "prt_p11",
      "prt_p1",
      "prt_p12",
      "prt_p7",
      "prt_p21",
      "prt_p8",
      "prt_p9",
    ]) {
      const part = allPartsFixtureJson.parts.find((item) => item.id === partId);
      expect(part).toBeDefined();
      applyPartDelta(SERVER, SESSION, part as Part);
    }
    render(() => (
      <MessageBubble
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_m2"
        partIds={[
          "prt_p3",
          "prt_p6",
          "prt_p10",
          "prt_p11",
          "prt_p1",
          "prt_p12",
          "prt_p7",
          "prt_p21",
          "prt_p8",
          "prt_p9",
        ]}
      />
    ));

    const bubble = screen.getByTestId("message-msg_m2");
    expect(bubble).toHaveTextContent("Let me check the existing project structure first.");

    const file = bubble.querySelector('[data-testid="file-part"]');
    expect(file).not.toBeNull();
    expect(file).toHaveTextContent("login-flow.png");
    expect(file).toHaveTextContent("Content unavailable");

    const patch = bubble.querySelector('[data-testid="patch-part"]');
    expect(patch).not.toBeNull();
    expect(patch).toHaveTextContent("Patch");
    expect(patch?.querySelectorAll('[data-testid="patch-file"]')).toHaveLength(2);

    const snapshot = bubble.querySelector('[data-testid="snapshot-part"]');
    expect(snapshot).not.toBeNull();
    expect(snapshot).toHaveTextContent("Snapshot");
    expect(snapshot).toHaveTextContent("snp_a1b2c3d4");

    // Step boundary parts are deliberately not rendered (chat refactor):
    // the store still carries them, the bubble skips them.
    expect(bubble.querySelector('[data-testid="step-start-part"]')).toBeNull();
    expect(bubble.querySelector('[data-testid="step-finish-part"]')).toBeNull();

    // Subtask and agent parts are intentionally hidden from the transcript;
    // the TaskPanel is their dedicated UI.
    expect(bubble.querySelector('[data-testid="subtask-part"]')).toBeNull();
    expect(bubble.querySelector('[data-testid="agent-part"]')).toBeNull();

    const retry = bubble.querySelector('[data-testid="retry-part"]');
    expect(retry).not.toBeNull();
    expect(retry).toHaveTextContent("Retrying (attempt 2)");
    expect(retry).toHaveTextContent("rate limited by the model provider");

    const compaction = bubble.querySelector('[data-testid="compaction-part"]');
    expect(compaction).not.toBeNull();
    expect(compaction).toHaveTextContent("Context compacted");
  });

  it("renders process parts before the final answer in one fold", async () => {
    upsertMessage(SERVER, SESSION, userMessage("msg_order"));
    applyPartDelta(SERVER, SESSION, {
      id: "prt_text",
      sessionID: SESSION,
      messageID: "msg_order",
      type: "text",
      text: "the final answer",
    } as never);
    applyPartDelta(SERVER, SESSION, {
      id: "prt_r",
      sessionID: SESSION,
      messageID: "msg_order",
      type: "reasoning",
      text: "intermediate reasoning",
      time: { start: 1, end: 2 },
    } as never);
    applyPartDelta(SERVER, SESSION, {
      id: "prt_tool",
      sessionID: SESSION,
      messageID: "msg_order",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "completed",
        input: {},
        output: "ok",
        title: "bash",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    } as never);
    render(() => (
      <MessageBubble
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_order"
        partIds={["prt_text", "prt_r", "prt_tool"]}
      />
    ));

    const bubble = screen.getByTestId("message-msg_order");
    const text = bubble.querySelector('[data-testid="text-part"]');
    const fold = bubble.querySelector('[data-testid="process-fold"]');
    expect(text).not.toBeNull();
    expect(fold).not.toBeNull();
    // The process precedes the final answer, matching the run chronology.
    expect(fold?.compareDocumentPosition(text as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // Collapsed by default; expanding reveals the reasoning and tool parts.
    expect(screen.getByTestId("process-fold-toggle")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByTestId("process-fold-toggle"));
    expect(screen.getByTestId("reasoning-body")).toHaveTextContent("intermediate reasoning");
    expect(screen.getByTestId("tool-part")).toHaveAttribute("data-status", "completed");
  });

  it("combines earlier assistant progress with the final answer and run outcome", async () => {
    upsertMessage(SERVER, SESSION, userMessage("msg_user"));
    upsertMessage(SERVER, SESSION, assistantMessage("msg_step", "msg_user", 2000));
    upsertMessage(SERVER, SESSION, assistantMessage("msg_final", "msg_user", 4000));
    applyPartDelta(SERVER, SESSION, {
      id: "prt_progress",
      sessionID: SESSION,
      messageID: "msg_step",
      type: "text",
      text: "I found the relevant message components.",
      time: { start: 2100, end: 2200 },
    } as unknown as Part);
    applyPartDelta(SERVER, SESSION, {
      id: "prt_edit",
      sessionID: SESSION,
      messageID: "msg_step",
      type: "tool",
      callID: "call_edit",
      tool: "edit",
      state: {
        status: "completed",
        input: { filePath: "src/chat.tsx" },
        output: "ok",
        title: "edit",
        metadata: {},
        time: { start: 2300, end: 2500 },
      },
    } as unknown as Part);
    applyPartDelta(SERVER, SESSION, {
      id: "prt_final",
      sessionID: SESSION,
      messageID: "msg_final",
      type: "text",
      text: "The chat flow is now complete.",
      time: { start: 4100, end: 4500 },
    } as Part);

    render(() => (
      <MessageBubble
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_final"
        partIds={["prt_final"]}
        activityPartIds={["prt_progress", "prt_edit"]}
        runPartIds={["prt_progress", "prt_edit", "prt_final"]}
        runKey="run:msg_user"
        runStartedAt={2000}
        runCompletedAt={5000}
        runParentMessageID="msg_user"
        runDiffs={[{ file: "src/chat.tsx", additions: 9, deletions: 2, status: "modified" }]}
      />
    ));

    const bubble = screen.getByTestId("message-msg_final");
    expect(bubble).toHaveTextContent("The chat flow is now complete.");
    const fold = screen.getByTestId("process-fold");
    expect(screen.getByTestId("process-fold-body")).toHaveAttribute("aria-hidden", "true");
    const answer = screen
      .getByText("The chat flow is now complete.")
      .closest("[data-testid='text-part']");
    const outcome = screen.getByTestId("run-outcome");
    expect(fold.compareDocumentPosition(answer as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(answer?.compareDocumentPosition(outcome)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(screen.getByTestId("process-fold-toggle"));
    expect(bubble).toHaveTextContent("I found the relevant message components.");
    expect(screen.getByTestId("run-files-toggle")).toHaveTextContent("1 changed file");
  });

  it("keeps the caret in place across text deltas", async () => {
    seedMessage("msg_a", ["prt_1"], ["one"]);
    render(() => (
      <MessageBubble
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_a"
        partIds={["prt_1"]}
        typing
      />
    ));
    const bubble = screen.getByTestId("message-msg_a");
    expect(bubble.querySelector('[data-testid="typing-cursor"]')).not.toBeNull();

    applyTextDelta(SERVER, SESSION, {
      messageID: "msg_a",
      partID: "prt_1",
      field: "text",
      delta: " two",
    });
    await waitFor(() =>
      expect(bubble.querySelector('[data-testid="typing-cursor"]')).not.toBeNull(),
    );
    expect(messages[SERVER][SESSION].parts["prt_1"]).toMatchObject({ text: "one two" });
  });

  it("keeps the process fold expanded across part replacements and deltas", async () => {
    upsertMessage(SERVER, SESSION, userMessage("msg_r"));
    applyPartDelta(SERVER, SESSION, {
      id: "prt_r",
      sessionID: SESSION,
      messageID: "msg_r",
      type: "reasoning",
      text: "first reasoning line",
      time: { start: 1, end: 2 },
    } as never);
    render(() => (
      <MessageBubble serverId={SERVER} sessionId={SESSION} messageID="msg_r" partIds={["prt_r"]} />
    ));
    const toggle = screen.getByTestId("process-fold-toggle");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("reasoning-body")).toBeInTheDocument();

    // A streamed delta appends without collapsing the fold.
    applyTextDelta(SERVER, SESSION, {
      messageID: "msg_r",
      partID: "prt_r",
      field: "text",
      delta: " + more reasoning",
    });
    expect(screen.getByTestId("reasoning-body")).toBeInTheDocument();

    // message.part.updated replaces the part object wholesale; the fold
    // must stay expanded (the component instance survives the swap).
    applyPartDelta(SERVER, SESSION, {
      id: "prt_r",
      sessionID: SESSION,
      messageID: "msg_r",
      type: "reasoning",
      text: "first reasoning line + more reasoning",
      time: { start: 1, end: 2 },
    } as never);
    expect(screen.getByTestId("reasoning-body")).toBeInTheDocument();
    expect(screen.getByTestId("reasoning-body")).toHaveTextContent(
      "first reasoning line + more reasoning",
    );
  });

  it("keeps the process fold collapsed while streaming", async () => {
    const [streaming, setStreaming] = createSignal(true);
    upsertMessage(SERVER, SESSION, userMessage("msg_r"));
    applyPartDelta(SERVER, SESSION, {
      id: "prt_r",
      sessionID: SESSION,
      messageID: "msg_r",
      type: "reasoning",
      text: "thinking in progress",
      time: { start: 1 },
    } as never);
    render(() => (
      <MessageBubble
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_r"
        partIds={["prt_r"]}
        streaming={streaming()}
      />
    ));

    // Streaming exposes an active status without forcing the trace open.
    await waitFor(() =>
      expect(screen.getByTestId("process-fold-toggle")).toHaveAttribute("aria-expanded", "false"),
    );
    expect(screen.getByTestId("process-fold")).toHaveAttribute("data-active", "true");

    // The caller can update streaming without changing disclosure state.
    setStreaming(false);
    await waitFor(() =>
      expect(screen.getByTestId("process-fold-toggle")).toHaveAttribute("aria-expanded", "false"),
    );

    // The user can inspect the trace on demand.
    fireEvent.click(screen.getByTestId("process-fold-toggle"));
    expect(screen.getByTestId("reasoning-body")).toBeInTheDocument();
  });

  it("keeps a manual mid-stream collapse effective after part replacement and stream end", async () => {
    const [streaming, setStreaming] = createSignal(true);
    upsertMessage(SERVER, SESSION, userMessage("msg_r"));
    applyPartDelta(SERVER, SESSION, {
      id: "prt_r",
      sessionID: SESSION,
      messageID: "msg_r",
      type: "reasoning",
      text: "thinking in progress",
      time: { start: 1 },
    } as never);
    render(() => (
      <MessageBubble
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_r"
        partIds={["prt_r"]}
        streaming={streaming()}
      />
    ));

    // The trace starts collapsed and the user can open it manually.
    const toggle = screen.getByTestId("process-fold-toggle");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // message.part.updated replaces the part object; the manual choice
    // (expanded) must survive the swap instead of being reset.
    applyPartDelta(SERVER, SESSION, {
      id: "prt_r",
      sessionID: SESSION,
      messageID: "msg_r",
      type: "reasoning",
      text: "thinking in progress, still thinking",
      time: { start: 1 },
    } as never);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Stream ends: fold stays expanded because the user opened it.
    setStreaming(false);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // And the toggle still works after part replacement.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

/** The markdown container whose text equals `text` (trimmed). */
function withinMarkdown(container: HTMLElement, text: string): HTMLElement | null {
  for (const el of container.querySelectorAll<HTMLElement>('[data-testid="markdown-text"]')) {
    if (el.textContent?.trim() === text) return el;
  }
  return null;
}
