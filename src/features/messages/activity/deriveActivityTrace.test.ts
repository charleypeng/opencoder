import { describe, expect, it } from "vitest";
import type { Part } from "../../../stores/messages.js";
import { deriveActivityTrace } from "./deriveActivityTrace";

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

function tool(status: "pending" | "running" | "completed" | "error"): Part {
  const base = {
    id: `tool-${status}`,
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool" as const,
    callID: `call-${status}`,
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
      output: "done\nmore output",
      title: "Run tests",
      metadata: {},
      time: { start: 110, end: 140 },
    },
  };
}

function progressText(): Part {
  return {
    id: "text-progress",
    sessionID: "session-1",
    messageID: "message-1",
    type: "text",
    text: "I found the renderer and am checking its event flow.",
    time: { start: 105, end: 108 },
  };
}

describe("deriveActivityTrace", () => {
  it("maps observable parts to ordered phases and statuses", () => {
    const entries = deriveActivityTrace(
      [reasoning("planning", 105), tool("running"), tool("completed")],
      150,
      "message-1",
    );

    expect(entries).toMatchObject([
      {
        id: "reasoning-1",
        runKey: "message-1",
        kind: "summary",
        phase: "decide",
        status: "complete",
        duration: 5,
      },
      { kind: "command", phase: "verify", status: "active" },
      { kind: "command", phase: "verify", status: "complete", title: "Run tests", duration: 30 },
    ]);
    expect(entries[2]?.preview).toBe("done");
  });

  it("keeps attention events visible and summarizes details", () => {
    const compaction: Part = {
      id: "compact-1",
      sessionID: "session-1",
      messageID: "message-1",
      type: "compaction",
      auto: true,
      overflow: true,
    };
    const retry: Part = {
      id: "retry-1",
      sessionID: "session-1",
      messageID: "message-1",
      type: "retry",
      attempt: 2,
      error: { name: "APIError", data: { message: "temporary failure" } },
      time: { created: 200 },
    } as Part;

    expect(deriveActivityTrace([compaction, retry, tool("error")])).toMatchObject([
      { kind: "compaction", phase: "attention", status: "complete" },
      { kind: "retry", phase: "attention", status: "failed", preview: "temporary failure" },
      { kind: "command", status: "failed", preview: "permission denied" },
    ]);
  });

  it("ignores unsupported and missing parts without reordering supported entries", () => {
    const unsupported = {
      id: "step-1",
      sessionID: "session-1",
      messageID: "message-1",
      type: "step-start",
    } as Part;
    const entries = deriveActivityTrace([undefined, unsupported, reasoning("one")]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourcePartId).toBe("reasoning-1");
  });

  it("keeps observable progress text as an expandable timeline update", () => {
    expect(deriveActivityTrace([progressText()])).toMatchObject([
      {
        id: "text-progress",
        kind: "note",
        phase: "understand",
        status: "complete",
        preview: "I found the renderer and am checking its event flow.",
      },
    ]);
  });

  it("collapses running and completed updates for one tool call into one entry", () => {
    const running = tool("running") as Extract<Part, { type: "tool" }>;
    const completed = tool("completed") as Extract<Part, { type: "tool" }>;
    completed.id = "tool-completed-later";
    completed.callID = running.callID;

    const entries = deriveActivityTrace([running, progressText(), completed], 150);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "tool-completed-later",
      kind: "command",
      status: "complete",
      duration: 30,
    });
    expect(entries[1]).toMatchObject({ kind: "note" });
  });
});
