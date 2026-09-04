import { describe, expect, it } from "vitest";
import type { Message, Part } from "../../../stores/messages.js";
import { deriveAgentRows, deriveRunOutcome } from "./agentRun.js";

function userMessage(id: string, created: number): Message {
  return {
    id,
    sessionID: "session-1",
    role: "user",
    time: { created },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5" },
  };
}

function assistantMessage(
  id: string,
  parentID: string,
  created: number,
  completed?: number,
): Message {
  return {
    id,
    sessionID: "session-1",
    role: "assistant",
    parentID,
    time: { created, ...(completed === undefined ? {} : { completed }) },
    modelID: "gpt-5",
    providerID: "openai",
    mode: "primary",
    agent: "build",
    path: { cwd: "/project", root: "/project" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function text(id: string, messageID: string, value: string): Part {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "text",
    text: value,
  };
}

function reasoning(id: string, messageID: string): Part {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "reasoning",
    text: "Inspecting the project",
    time: { start: 1100, end: 1200 },
  };
}

function completedTool(
  id: string,
  messageID: string,
  callID: string,
  tool: string,
  input: Record<string, unknown>,
): Part {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "tool",
    callID,
    tool,
    state: {
      status: "completed",
      input: input as never,
      output: "ok",
      title: tool,
      metadata: {},
      time: { start: 1200, end: 1300 },
    },
  };
}

describe("deriveAgentRows", () => {
  it("groups consecutive assistant messages into one user-task run", () => {
    const infos: Record<string, Message> = {
      user: userMessage("user", 1000),
      step: assistantMessage("step", "user", 1100, 1500),
      answer: assistantMessage("answer", "user", 1600, 2200),
    };
    const parts: Record<string, Part> = {
      userText: text("userText", "user", "Fix the issue"),
      thought: reasoning("thought", "step"),
      progress: text("progress", "step", "I am checking the renderer."),
      edit: completedTool("edit", "step", "call-edit", "edit", {
        filePath: "src/view.tsx",
      }),
      answerText: text("answerText", "answer", "Fixed and verified."),
      command: completedTool("command", "answer", "call-test", "bash", {
        command: "pnpm test",
      }),
    };

    const rows = deriveAgentRows(
      [
        { messageID: "user", partIds: ["userText"] },
        { messageID: "step", partIds: ["thought", "progress", "edit"] },
        { messageID: "answer", partIds: ["command", "answerText"] },
      ],
      infos,
      parts,
      { busy: false, busySince: 1000, sessionId: "session-1" },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "message", messageID: "user" });
    expect(rows[1]).toMatchObject({
      kind: "assistant-run",
      key: "run:user",
      messageID: "answer",
      parentMessageID: "user",
      partIds: ["answerText"],
      activityPartIds: ["thought", "progress", "edit", "command"],
      allPartIds: ["thought", "progress", "edit", "command", "answerText"],
      startedAt: 1100,
      completedAt: 2200,
      active: false,
    });
  });

  it("adds an immediate working row before the first assistant event", () => {
    const infos = { user: userMessage("user", 1000) };
    const parts = { userText: text("userText", "user", "Fix the issue") };

    const rows = deriveAgentRows([{ messageID: "user", partIds: ["userText"] }], infos, parts, {
      busy: true,
      busySince: 1250,
      sessionId: "session-1",
    });

    expect(rows[1]).toEqual({
      kind: "working",
      key: "working:user",
      messageID: "working:user",
      partIds: [],
      activityPartIds: [],
      allPartIds: [],
      parentMessageID: "user",
      startedAt: 1250,
      completedAt: undefined,
      active: true,
    });
  });

  it("marks the latest matching assistant run active without adding a duplicate row", () => {
    const infos: Record<string, Message> = {
      user: userMessage("user", 1000),
      step: assistantMessage("step", "user", 1100),
    };
    const parts = { thought: reasoning("thought", "step") };

    const rows = deriveAgentRows(
      [
        { messageID: "user", partIds: [] },
        { messageID: "step", partIds: ["thought"] },
      ],
      infos,
      parts,
      { busy: true, busySince: 1050, sessionId: "session-1" },
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ kind: "assistant-run", active: true });
  });
});

describe("deriveRunOutcome", () => {
  it("summarizes authoritative diffs, edited files, and completed commands", () => {
    const parts: Part[] = [
      completedTool("edit", "step", "call-edit", "edit", { filePath: "src/view.tsx" }),
      completedTool("write", "step", "call-write", "write", { path: "src/new.ts" }),
      completedTool("bash", "step", "call-test", "bash", { command: "pnpm test" }),
      {
        id: "patch",
        sessionID: "session-1",
        messageID: "step",
        type: "patch",
        hash: "abc",
        files: ["src/extra.ts"],
      },
    ];

    const outcome = deriveRunOutcome(parts, [
      { file: "src/view.tsx", additions: 8, deletions: 2, status: "modified" },
    ]);

    expect(outcome.files).toEqual([
      { path: "src/view.tsx", additions: 8, deletions: 2, status: "modified" },
      { path: "src/new.ts" },
      { path: "src/extra.ts" },
    ]);
    expect(outcome.commands).toEqual(["pnpm test"]);
    expect(outcome.additions).toBe(8);
    expect(outcome.deletions).toBe(2);
  });

  it("deduplicates lifecycle updates for the same command call", () => {
    const running: Part = {
      id: "bash-running",
      sessionID: "session-1",
      messageID: "step",
      type: "tool",
      callID: "call-test",
      tool: "bash",
      state: {
        status: "running",
        input: { command: "pnpm verify" } as never,
        time: { start: 1200 },
      },
    };
    const completed = completedTool("bash-complete", "step", "call-test", "bash", {
      command: "pnpm verify",
    });

    expect(deriveRunOutcome([running, completed], []).commands).toEqual(["pnpm verify"]);
  });

  it("deduplicates absolute patch paths against relative diff paths", () => {
    const patch: Part = {
      id: "patch",
      sessionID: "session-1",
      messageID: "step",
      type: "patch",
      hash: "abc",
      files: ["/Volumes/Doc/dev/codewalk/README.md"],
    };

    const outcome = deriveRunOutcome(
      [patch],
      [{ file: "README.md", additions: 1, deletions: 1, status: "modified" }],
    );

    expect(outcome.files).toEqual([
      { path: "README.md", additions: 1, deletions: 1, status: "modified" },
    ]);
  });
});
