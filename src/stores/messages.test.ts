// L1 tests for the messages store (TASK-M2-02): normalization (dedupe by id,
// stable order), delta appends with O(1) single-part updates, stub creation
// when a delta arrives before its part, part/message removal and per-server
// reset. TASK-M2-08: optimistic local messages reconcile onto their server
// echo through upsertMessage.

import { afterEach, describe, expect, it } from "vitest";
import type { Message, Part } from "./messages.js";
import {
  applyPartDelta,
  applyTextDelta,
  getServerMessages,
  messages,
  removeMessage,
  removePart,
  removePartsForMessage,
  resetServer,
  trackPendingLocalMessage,
  untrackPendingLocalMessage,
  upsertMessage,
} from "./messages.js";

const SESSION = "ses_abc123";
const MSG_ASSISTANT = "msg_asst_001";

function textOf(part: Part): string {
  return (part as { text?: string }).text ?? "";
}

function textPart(id: string, text: string): Part {
  return {
    id,
    sessionID: SESSION,
    messageID: MSG_ASSISTANT,
    type: "text",
    text,
    time: { start: 1, end: 2 },
  };
}

function userMessage(id: string, extra: Record<string, unknown> = {}): Message {
  return {
    id,
    sessionID: SESSION,
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5" },
    ...(extra as object),
  } as Message;
}

function assistantMessage(id: string): Message {
  return {
    id,
    sessionID: SESSION,
    role: "assistant",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5" },
    parentID: "msg_user_001",
    modelID: "gpt-5",
    providerID: "openai",
    mode: "primary",
    path: { cwd: "/p", root: "/p" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as Message;
}

afterEach(() => {
  resetServer("srv-msg");
  resetServer("srv-msg-b");
});

describe("messages store", () => {
  it("starts with an empty bucket", () => {
    expect(getServerMessages("srv-msg")).toEqual({});
  });

  it("upsertMessage stores info and carries parts into the normalized table", () => {
    const info = userMessage("msg_user_001");
    upsertMessage("srv-msg", SESSION, info);
    expect(messages["srv-msg"][SESSION].info).toEqual(info);
    expect(messages["srv-msg"][SESSION].infos).toEqual({ msg_user_001: info });
    expect(messages["srv-msg"][SESSION].order).toEqual([]);

    // Defensive: an info payload carrying parts normalizes them.
    upsertMessage(
      "srv-msg",
      SESSION,
      userMessage("msg_user_001", { parts: [textPart("prt_1", "hi")] }),
    );
    expect(messages["srv-msg"][SESSION].parts["prt_1"]).toEqual(textPart("prt_1", "hi"));
    expect(messages["srv-msg"][SESSION].order).toEqual(["prt_1"]);
  });

  it("upsertMessage keeps per-message infos for history rendering", () => {
    const first = userMessage("msg_1");
    const second = userMessage("msg_2");
    upsertMessage("srv-msg", SESSION, first);
    upsertMessage("srv-msg", SESSION, second);
    const entry = messages["srv-msg"][SESSION];
    expect(entry.infos).toEqual({ msg_1: first, msg_2: second });
    // The legacy single-info slot reflects the most recent message.
    expect(entry.info).toEqual(second);
  });

  it("applyPartDelta upserts by id without duplicate order entries", () => {
    applyPartDelta("srv-msg", SESSION, textPart("prt_a", "one"));
    applyPartDelta("srv-msg", SESSION, textPart("prt_b", "two"));
    applyPartDelta("srv-msg", SESSION, { ...textPart("prt_a", "one updated") });
    expect(messages["srv-msg"][SESSION].order).toEqual(["prt_a", "prt_b"]);
    expect(textOf(messages["srv-msg"][SESSION].parts["prt_a"])).toBe("one updated");
  });

  it("applyPartDelta replaces the part wholesale on full-state events", () => {
    applyPartDelta("srv-msg", SESSION, textPart("prt_x", "stale"));
    applyPartDelta("srv-msg", SESSION, textPart("prt_x", "fresh full state"));
    expect(textOf(messages["srv-msg"][SESSION].parts["prt_x"])).toBe("fresh full state");
  });

  it("applyTextDelta appends to text and output fields", () => {
    applyPartDelta("srv-msg", SESSION, textPart("prt_t", "Hello"));
    applyTextDelta("srv-msg", SESSION, {
      messageID: MSG_ASSISTANT,
      partID: "prt_t",
      field: "text",
      delta: " world",
    });
    applyTextDelta("srv-msg", SESSION, {
      messageID: MSG_ASSISTANT,
      partID: "prt_t",
      field: "text",
      delta: "!",
    });
    expect(textOf(messages["srv-msg"][SESSION].parts["prt_t"])).toBe("Hello world!");

    const tool = {
      id: "prt_tool",
      sessionID: SESSION,
      messageID: MSG_ASSISTANT,
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "running", input: {}, time: { start: 1 } },
    } as Part;
    applyPartDelta("srv-msg", SESSION, tool);
    applyTextDelta("srv-msg", SESSION, {
      messageID: MSG_ASSISTANT,
      partID: "prt_tool",
      field: "output",
      delta: "src/",
    });
    applyTextDelta("srv-msg", SESSION, {
      messageID: MSG_ASSISTANT,
      partID: "prt_tool",
      field: "output",
      delta: "\ndocs/",
    });
    expect((messages["srv-msg"][SESSION].parts["prt_tool"] as { output?: string }).output).toBe(
      "src/\ndocs/",
    );
  });

  it("appends delta to a stub when the delta arrives before the part", () => {
    applyTextDelta("srv-msg", SESSION, {
      messageID: MSG_ASSISTANT,
      partID: "prt_stub",
      field: "text",
      delta: "stream",
    });
    applyTextDelta("srv-msg", SESSION, {
      messageID: MSG_ASSISTANT,
      partID: "prt_stub",
      field: "text",
      delta: "ing",
    });
    expect(messages["srv-msg"][SESSION].order).toEqual(["prt_stub"]);
    expect(messages["srv-msg"][SESSION].parts["prt_stub"]).toMatchObject({
      id: "prt_stub",
      type: "text",
      text: "streaming",
    });

    // The later full-state part.updated replaces the stub.
    applyPartDelta("srv-msg", SESSION, textPart("prt_stub", "complete text"));
    expect(textOf(messages["srv-msg"][SESSION].parts["prt_stub"])).toBe("complete text");
    expect(messages["srv-msg"][SESSION].order).toEqual(["prt_stub"]);
  });

  it("removePart drops the part and keeps order in sync", () => {
    applyPartDelta("srv-msg", SESSION, textPart("prt_a", "a"));
    applyPartDelta("srv-msg", SESSION, textPart("prt_b", "b"));
    removePart("srv-msg", SESSION, "prt_a");
    expect(messages["srv-msg"][SESSION].order).toEqual(["prt_b"]);
    expect("prt_a" in messages["srv-msg"][SESSION].parts).toBe(false);
  });

  it("removePartsForMessage drops the message's parts and its info", () => {
    const info = userMessage("msg_asst_001", {
      role: "assistant",
      parentID: "msg_user_001",
      modelID: "gpt-5",
      providerID: "openai",
      mode: "primary",
      path: { cwd: "/p", root: "/p" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    upsertMessage("srv-msg", SESSION, info);
    applyPartDelta("srv-msg", SESSION, textPart("prt_a", "a"));
    applyPartDelta("srv-msg", SESSION, textPart("prt_b", "b"));

    // A part of another message must survive.
    applyPartDelta("srv-msg", SESSION, { ...textPart("prt_c", "c"), messageID: "msg_other" });

    removePartsForMessage("srv-msg", SESSION, MSG_ASSISTANT);
    const entry = messages["srv-msg"][SESSION];
    expect(entry.order).toEqual(["prt_c"]);
    expect("prt_a" in entry.parts).toBe(false);
    expect(entry.info).toBeNull();
    expect(entry.infos[MSG_ASSISTANT]).toBeUndefined();
    expect(entry.parts["prt_c"].messageID).toBe("msg_other");
  });

  it("removeMessage drops the whole session bucket", () => {
    applyPartDelta("srv-msg", SESSION, textPart("prt_a", "a"));
    removeMessage("srv-msg", SESSION);
    expect(messages["srv-msg"][SESSION]).toBeUndefined();
  });

  it("keeps servers independent and resetServer clears only its own bucket", () => {
    applyPartDelta("srv-msg", SESSION, textPart("prt_a", "a"));
    applyPartDelta("srv-msg-b", SESSION, textPart("prt_b", "b"));
    resetServer("srv-msg");
    expect(messages["srv-msg"]).toBeUndefined();
    expect(messages["srv-msg-b"][SESSION].order).toEqual(["prt_b"]);
  });

  it("upsertMessage rolls a tracked local message over onto its server echo", () => {
    // TASK-M2-08: the optimistic local-* insert is followed by the server
    // echo (message.updated with a real id, metadata only). The first real
    // server message reconciles: the local part is re-issued under the
    // echoed message id so the prompt text survives, the local info is
    // dropped, and the marker is cleared.
    upsertMessage("srv-msg", SESSION, userMessage("local-1"));
    applyPartDelta("srv-msg", SESSION, {
      id: "local-part-1",
      sessionID: SESSION,
      messageID: "local-1",
      type: "text",
      text: "hello",
    } as Part);
    trackPendingLocalMessage("srv-msg", SESSION, "local-1");

    upsertMessage("srv-msg", SESSION, userMessage("msg_echo_1"));

    const entry = messages["srv-msg"][SESSION];
    expect("local-1" in entry.infos).toBe(false);
    expect(entry.order).toEqual(["prt-msg_echo_1"]);
    expect(entry.parts["prt-msg_echo_1"]).toMatchObject({
      id: "prt-msg_echo_1",
      messageID: "msg_echo_1",
      type: "text",
      text: "hello",
    });

    // Reconciliation is one-shot: later messages upsert normally and the
    // migrated part stays put.
    upsertMessage("srv-msg", SESSION, userMessage("msg_echo_2"));
    expect(Object.keys(entry.infos)).toEqual(["msg_echo_1", "msg_echo_2"]);
    expect(entry.order).toEqual(["prt-msg_echo_1"]);
  });

  it("untrackPendingLocalMessage keeps the local message until its echo", () => {
    upsertMessage("srv-msg", SESSION, userMessage("local-2"));
    applyPartDelta("srv-msg", SESSION, {
      id: "local-part-2",
      sessionID: SESSION,
      messageID: "local-2",
      type: "text",
      text: "stays",
    } as Part);
    trackPendingLocalMessage("srv-msg", SESSION, "local-2");
    untrackPendingLocalMessage("srv-msg", SESSION);

    upsertMessage("srv-msg", SESSION, userMessage("msg_other"));
    const entry = messages["srv-msg"][SESSION];
    expect(entry.infos["local-2"]).toBeDefined();
    expect(entry.order).toEqual(["local-part-2"]);
  });

  it("drops the local message when the echo already carries its own text part", () => {
    // TASK-M2-08: an echo that brings its own text (carried on the info
    // payload) replaces the optimistic bubble instead of being overwritten
    // by the re-issued local part.
    upsertMessage("srv-msg", SESSION, userMessage("local-1"));
    applyPartDelta("srv-msg", SESSION, {
      id: "local-part-1",
      sessionID: SESSION,
      messageID: "local-1",
      type: "text",
      text: "hello",
    } as Part);
    trackPendingLocalMessage("srv-msg", SESSION, "local-1");

    upsertMessage(
      "srv-msg",
      SESSION,
      userMessage("msg_echo_1", {
        parts: [
          {
            id: "prt_echo_1",
            sessionID: SESSION,
            messageID: "msg_echo_1",
            type: "text",
            text: "hello",
          },
        ],
      }),
    );

    const entry = messages["srv-msg"][SESSION];
    expect(Object.keys(entry.infos)).toEqual(["msg_echo_1"]);
    expect(entry.order).toEqual(["prt_echo_1"]);
    expect(Object.keys(entry.parts)).toEqual(["prt_echo_1"]);
    expect(textOf(entry.parts["prt_echo_1"])).toBe("hello");
    // No duplicates in order and no local-* survivors anywhere.
    expect(entry.order).toHaveLength(new Set(entry.order).size);
    expect(entry.parts["local-part-1"]).toBeUndefined();
    expect("local-1" in entry.infos).toBe(false);
  });

  it("reconciles when the echo part arrives before the echo message", () => {
    // TASK-M2-08 ordering safety: message.part.updated for the echo can
    // arrive before message.updated. The part-first path runs the same
    // reconciliation and consumes the marker exactly once.
    upsertMessage("srv-msg", SESSION, userMessage("local-1"));
    applyPartDelta("srv-msg", SESSION, {
      id: "local-part-1",
      sessionID: SESSION,
      messageID: "local-1",
      type: "text",
      text: "hello",
    } as Part);
    trackPendingLocalMessage("srv-msg", SESSION, "local-1");

    applyPartDelta("srv-msg", SESSION, {
      id: "prt_echo_1",
      sessionID: SESSION,
      messageID: "msg_echo_1",
      type: "text",
      text: "hello",
    } as Part);

    const entry = messages["srv-msg"][SESSION];
    expect(entry.order).toEqual(["prt_echo_1"]);
    expect(Object.keys(entry.infos)).toEqual([]);
    expect("local-part-1" in entry.parts).toBe(false);

    // The message.updated that follows must not re-reconcile: the marker
    // was consumed and the part list stays free of duplicates.
    upsertMessage("srv-msg", SESSION, userMessage("msg_echo_1"));
    expect(Object.keys(entry.infos)).toEqual(["msg_echo_1"]);
    expect(entry.order).toEqual(["prt_echo_1"]);
    expect(entry.order).toHaveLength(new Set(entry.order).size);
  });

  it("reconciles when a delta for the echo arrives before the part and message", () => {
    // TASK-M2-08: the delta-stub path (message.part.delta before the part
    // and the message) reconciles the same way as part-first ordering.
    upsertMessage("srv-msg", SESSION, userMessage("local-1"));
    applyPartDelta("srv-msg", SESSION, {
      id: "local-part-1",
      sessionID: SESSION,
      messageID: "local-1",
      type: "text",
      text: "hello",
    } as Part);
    trackPendingLocalMessage("srv-msg", SESSION, "local-1");

    applyTextDelta("srv-msg", SESSION, {
      messageID: "msg_echo_1",
      partID: "prt_echo_1",
      field: "text",
      delta: "stream",
    });

    const entry = messages["srv-msg"][SESSION];
    expect(entry.order).toEqual(["prt_echo_1"]);
    expect("local-1" in entry.infos).toBe(false);
    expect("local-part-1" in entry.parts).toBe(false);
    expect(textOf(entry.parts["prt_echo_1"])).toBe("stream");
  });

  it("keeps the marker and the local message when a non-user message arrives first", () => {
    // TASK-M2-08: only the user echo consumes the marker; an assistant
    // message (or any history replay) must not roll the optimistic bubble
    // over, otherwise the prompt text would be lost.
    upsertMessage("srv-msg", SESSION, userMessage("local-1"));
    applyPartDelta("srv-msg", SESSION, {
      id: "local-part-1",
      sessionID: SESSION,
      messageID: "local-1",
      type: "text",
      text: "hello",
    } as Part);
    trackPendingLocalMessage("srv-msg", SESSION, "local-1");

    upsertMessage("srv-msg", SESSION, assistantMessage("msg_asst_001"));
    const entry = messages["srv-msg"][SESSION];
    expect(entry.infos["local-1"]).toBeDefined();
    expect(entry.order).toEqual(["local-part-1"]);

    // The user echo that follows reconciles normally (marker still pending).
    upsertMessage("srv-msg", SESSION, userMessage("msg_echo_1"));
    expect("local-1" in entry.infos).toBe(false);
    expect(entry.order).toEqual(["prt-msg_echo_1"]);
    expect(textOf(entry.parts["prt-msg_echo_1"])).toBe("hello");
  });
});
