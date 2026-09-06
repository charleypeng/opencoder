import { describe, expect, it } from "vitest";
import type { Part } from "../../../stores/messages.js";
import { deriveProcessStatus } from "./processStatus";

function reasoning(text: string, end?: number): Part {
  return {
    id: "reasoning-1",
    sessionID: "session-1",
    messageID: "message-1",
    type: "reasoning",
    text,
    time: { start: 100, ...(end === undefined ? {} : { end }) },
  };
}

function tool(
  status: "pending" | "running" | "completed" | "error",
  callID = `call-${status}`,
): Part {
  const base = {
    id: `tool-${callID}`,
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool" as const,
    callID,
    tool: "bash",
  };
  if (status === "pending") return { ...base, state: { status, input: {}, raw: "pwd" } };
  if (status === "running") return { ...base, state: { status, input: {}, time: { start: 110 } } };
  if (status === "error") {
    return {
      ...base,
      state: { status, input: {}, error: "permission denied", time: { start: 110, end: 120 } },
    };
  }
  return {
    ...base,
    state: {
      status,
      input: {},
      output: "done",
      title: "Run tests",
      metadata: {},
      time: { start: 110, end: 140 },
    },
  };
}

function retry(): Part {
  return {
    id: "retry-1",
    sessionID: "session-1",
    messageID: "message-1",
    type: "retry",
    error: { data: { message: "rate limited" } },
    time: { created: 130 },
  } as Part;
}

describe("deriveProcessStatus", () => {
  it("reports waiting-model for an active run without parts", () => {
    expect(deriveProcessStatus([], { active: true })).toEqual({ kind: "waiting-model" });
  });

  it("reports the active reasoning preview", () => {
    const status = deriveProcessStatus([reasoning("checking the renderer")], { active: true });
    expect(status).toEqual({ kind: "reasoning", preview: "checking the renderer" });
  });

  it("reports running tools with the real parallel count", () => {
    const status = deriveProcessStatus(
      [tool("completed"), tool("running", "call-a"), tool("running", "call-b"), tool("pending")],
      { active: true },
    );
    expect(status).toEqual({ kind: "tool", running: 2, pending: 1, tool: "bash" });
  });

  it("falls back to a pending tool before anything ran", () => {
    const status = deriveProcessStatus([tool("pending")], { active: true });
    expect(status).toEqual({ kind: "tool", running: 0, pending: 1, tool: "bash" });
  });

  it("surfaces a retry ahead of other activity", () => {
    const status = deriveProcessStatus([tool("running"), retry()], { active: true });
    expect(status).toEqual({ kind: "retry", message: "rate limited" });
  });

  it("clears the retry status once the run moves on", () => {
    // A recovered retry stays in the parts array; the tail must follow the
    // newer tool activity instead of showing "Retrying" forever.
    const status = deriveProcessStatus([retry(), tool("running", "call-after")], {
      active: true,
    });
    expect(status).toEqual({ kind: "tool", running: 1, pending: 0, tool: "bash" });
  });

  it("clears the retry status once a compaction entry follows", () => {
    const compaction = {
      id: "compaction-1",
      sessionID: "session-1",
      messageID: "message-1",
      type: "compaction",
    } as Part;
    const status = deriveProcessStatus([retry(), compaction], { active: true });
    expect(status).toEqual({ kind: "waiting-model" });
  });

  it("reports a pending permission wait over synthetic activity", () => {
    const status = deriveProcessStatus([tool("running")], {
      active: true,
      waitingUser: "permission",
    });
    expect(status).toEqual({ kind: "waiting-user", channel: "permission" });
  });

  it("returns idle for a finished run even with stale active parts", () => {
    // Historical reasoning parts can miss time.end; the finished run must not
    // become permanently active because of them.
    const parts = [reasoning("planning"), tool("completed"), tool("running", "call-stale")];
    expect(deriveProcessStatus(parts, { active: false })).toEqual({ kind: "idle" });
  });
});
