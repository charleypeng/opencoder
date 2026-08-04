// Fixture schema validation (docs/testing.md §2.1, TASK-M0-06).
//
// Every fixture in tests/fixtures/ must conform to the generated OpenAPI
// types (src/services/api/schema.d.ts). The `satisfies` bindings below are
// compile-time checks enforced by `npx tsc -b`; the `it()` blocks run the
// runtime assertions (index integrity, required fields, Part type coverage).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { components } from "./schema";

import sessionListJson from "../../../tests/fixtures/session.list.json";
import sessionDetailJson from "../../../tests/fixtures/session.detail.json";
import sessionMessagesJson from "../../../tests/fixtures/session.messages.json";
import sessionMessageJson from "../../../tests/fixtures/session.message.json";
import allPartsJson from "../../../tests/fixtures/message.stream.all-parts.json";
import permissionJson from "../../../tests/fixtures/permission.asked.json";
import questionJson from "../../../tests/fixtures/question.asked.json";
import fileTreeJson from "../../../tests/fixtures/file.tree.json";
import diffJson from "../../../tests/fixtures/diff.session.json";
import todoJson from "../../../tests/fixtures/todo.list.json";
import ptyJson from "../../../tests/fixtures/pty.list.json";
import healthJson from "../../../tests/fixtures/health.json";
import projectListJson from "../../../tests/fixtures/project.list.json";
import projectCurrentJson from "../../../tests/fixtures/project.current.json";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
);

type Message = components["schemas"]["Message"];
type Part = components["schemas"]["Part"];
type Session = components["schemas"]["Session"];

// JSON imports (resolveJsonModule) widen string values to `string`, so a
// `satisfies` check against the literal-typed schemas would reject valid
// fixtures. WidenLiterals maps every literal/union literal to its widened
// counterpart while keeping the structural shape (required fields, nesting,
// field types) strict — exactly the check a recorded fixture must pass.
type WidenLiterals<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly unknown[]
        ? WidenLiterals<T[number]>[]
        : T extends object
          ? { [K in keyof T]: WidenLiterals<T[K]> }
          : T;

// The generated ToolState.input is Record<string, never>, a codegen artifact
// for the contract's free-form `type: object` (docs/openapi_v1.18.11.json);
// recorded tool parts carry the real input object (e.g. { command: "ls src" }),
// so widen that single field for the structural check.
type ToolStateRecorded =
  | (Omit<components["schemas"]["ToolStatePending"], "input"> & { input: Record<string, unknown> })
  | (Omit<components["schemas"]["ToolStateRunning"], "input"> & { input: Record<string, unknown> })
  | (Omit<components["schemas"]["ToolStateCompleted"], "input"> & {
      input: Record<string, unknown>;
    })
  | (Omit<components["schemas"]["ToolStateError"], "input"> & { input: Record<string, unknown> });

type RecordedPart =
  | Exclude<Part, components["schemas"]["ToolPart"]>
  | (Omit<components["schemas"]["ToolPart"], "state"> & { state: ToolStateRecorded });

// Compile-time structural checks: the imported JSON literal types must satisfy
// the generated schema types (widened). The bindings are referenced in the
// tests below so `noUnusedLocals` stays happy.
const sessionList = sessionListJson satisfies WidenLiterals<Session[]>;
const sessionDetail = sessionDetailJson satisfies WidenLiterals<Session>;
const sessionMessages = sessionMessagesJson satisfies WidenLiterals<
  { info: Message; parts: RecordedPart[] }[]
>;
const sessionMessage = sessionMessageJson satisfies WidenLiterals<{
  info: Message;
  parts: RecordedPart[];
}>;
const allParts = allPartsJson satisfies WidenLiterals<{ info: Message; parts: RecordedPart[] }>;
const permissionList = permissionJson satisfies WidenLiterals<
  components["schemas"]["PermissionRequest"][]
>;
const questionList = questionJson satisfies WidenLiterals<
  components["schemas"]["QuestionRequest"][]
>;
const fileTree = fileTreeJson satisfies WidenLiterals<components["schemas"]["FileNode"][]>;
const diffList = diffJson satisfies WidenLiterals<components["schemas"]["SnapshotFileDiff"][]>;
const todoList = todoJson satisfies WidenLiterals<components["schemas"]["Todo"][]>;
const ptyList = ptyJson satisfies WidenLiterals<components["schemas"]["Pty"][]>;
const health = healthJson satisfies WidenLiterals<{ healthy: true; version: string }>;
const projectList = projectListJson satisfies WidenLiterals<components["schemas"]["Project"][]>;
const projectCurrent = projectCurrentJson satisfies WidenLiterals<components["schemas"]["Project"]>;

// Every Part type the message stream fixture must cover (docs/testing.md §2.1).
const ALL_PART_TYPES = [
  "text",
  "reasoning",
  "tool",
  "file",
  "patch",
  "snapshot",
  "step-start",
  "step-finish",
  "subtask",
  "retry",
  "compaction",
] as const;

describe("recorded fixtures (tests/fixtures)", () => {
  it("index.json maps every key to an existing file", () => {
    const index = JSON.parse(readFileSync(join(fixturesDir, "index.json"), "utf8")) as Record<
      string,
      string
    >;
    expect(Object.keys(index).length).toBeGreaterThan(0);
    for (const [key, file] of Object.entries(index)) {
      expect(
        existsSync(join(fixturesDir, file)),
        `index key "${key}" -> missing file "${file}"`,
      ).toBe(true);
    }
  });

  it("message.stream.all-parts covers every Part type exactly once each", () => {
    const types = allParts.parts.map((part) => part.type);
    expect(new Set(types)).toEqual(new Set(ALL_PART_TYPES));

    const toolStates = allParts.parts
      .filter((part) => part.type === "tool")
      .map((part) => (part as { state: { status: string } }).state.status)
      .sort();
    // Tool parts cover every state of the four-state state machine plus
    // every tool family the renderers specialize (TASK-M3-01).
    expect(new Set(toolStates)).toEqual(new Set(["completed", "error", "pending", "running"]));
  });

  it("session fixtures carry required fields", () => {
    for (const session of sessionList) {
      expect(typeof session.id).toBe("string");
      expect(typeof session.title).toBe("string");
      expect(typeof session.version).toBe("string");
      expect(typeof session.time.created).toBe("number");
      expect(typeof session.time.updated).toBe("number");
    }
    expect(sessionDetail.id).toBe("ses_abc123");

    for (const entry of sessionMessages) {
      expect(typeof entry.info.id).toBe("string");
      expect(typeof entry.info.role).toBe("string");
      expect(Array.isArray(entry.parts)).toBe(true);
    }
    expect(sessionMessage.info.id).toBe("msg_m2");
    expect(Array.isArray(sessionMessage.parts)).toBe(true);
    expect(allParts.info.id).toBe("msg_m2");
  });

  it("permission / question / todo fixtures carry required fields", () => {
    for (const request of permissionList) {
      expect(request.id).toMatch(/^per_/);
      expect(typeof request.sessionID).toBe("string");
      expect(typeof request.permission).toBe("string");
      expect(Array.isArray(request.patterns)).toBe(true);
      expect(Array.isArray(request.always)).toBe(true);
    }
    for (const request of questionList) {
      expect(request.id).toMatch(/^que_/);
      expect(request.questions.length).toBeGreaterThan(0);
      for (const question of request.questions) {
        expect(typeof question.question).toBe("string");
        expect(typeof question.header).toBe("string");
        expect(question.options.length).toBeGreaterThan(0);
      }
    }
    for (const todo of todoList) {
      expect(typeof todo.content).toBe("string");
      expect(typeof todo.status).toBe("string");
      expect(typeof todo.priority).toBe("string");
    }
  });

  it("file tree / diff / pty fixtures carry required fields", () => {
    for (const node of fileTree) {
      expect(typeof node.name).toBe("string");
      expect(typeof node.path).toBe("string");
      expect(typeof node.absolute).toBe("string");
      expect(["file", "directory"]).toContain(node.type);
      expect(typeof node.ignored).toBe("boolean");
    }
    for (const diff of diffList) {
      expect(typeof diff.additions).toBe("number");
      expect(typeof diff.deletions).toBe("number");
    }
    for (const pty of ptyList) {
      expect(typeof pty.id).toBe("string");
      expect(Array.isArray(pty.args)).toBe(true);
      expect(["running", "exited"]).toContain(pty.status);
      expect(typeof pty.pid).toBe("number");
    }
    expect(health.healthy).toBe(true);
    expect(projectList[0].id).toBe("prj_001");
    expect(projectCurrent.id).toBe("prj_001");
  });

  it("fixtures contain no personal paths (redaction)", () => {
    const serialized = JSON.stringify([
      sessionList,
      sessionDetail,
      sessionMessages,
      fileTree,
      diffList,
      ptyList,
    ]);
    expect(serialized).not.toContain(os.homedir());
    expect(serialized).not.toMatch(/\/Users\/[^/]+/);
  });
});
