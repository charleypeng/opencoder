// L2 tests for the message bubble (TASK-M2-09): per-message store
// subscription — a delta on one part re-renders ONLY that part row, leaving
// sibling parts' DOM untouched (the M2-06 list regrouped and re-rendered
// every bubble on any mutation); the assistant role fallback for streamed
// parts without message info; the breathing typing caret mounted on the
// streaming text part while `typing`, and removed when it flips off.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render, screen, waitFor } from "@solidjs/testing-library";
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
});

afterEach(() => {
  resetServer(SERVER);
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

  it("renders file, patch and snapshot parts from the all-parts fixture", async () => {
    for (const partId of ["prt_p3", "prt_p6", "prt_p10", "prt_p11"]) {
      const part = allPartsFixtureJson.parts.find((item) => item.id === partId);
      expect(part).toBeDefined();
      applyPartDelta(SERVER, SESSION, part as Part);
    }
    render(() => (
      <MessageBubble
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_m2"
        partIds={["prt_p3", "prt_p6", "prt_p10", "prt_p11"]}
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
});

/** The markdown container whose text equals `text` (trimmed). */
function withinMarkdown(container: HTMLElement, text: string): HTMLElement | null {
  for (const el of container.querySelectorAll<HTMLElement>('[data-testid="markdown-text"]')) {
    if (el.textContent?.trim() === text) return el;
  }
  return null;
}
