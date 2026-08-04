// L1 tests for the @-menu skill helpers (TASK-M5-08): query matching,
// skills-group composition ahead of file rows, and the insert text.

import { describe, expect, it } from "vitest";
import type { Skill } from "../../services/skill.js";
import { atEntriesFor, atInsertText, skillMatches } from "./skills.js";

const SKILLS: Skill[] = [
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

describe("skillMatches", () => {
  it("matches a case-insensitive substring of the name", () => {
    expect(skillMatches(SKILLS[0], "search")).toBe(true);
    expect(skillMatches(SKILLS[0], "Research")).toBe(true);
    expect(skillMatches(SKILLS[2], "sql")).toBe(true);
  });

  it("does not match a disjoint query", () => {
    expect(skillMatches(SKILLS[0], "zzz")).toBe(false);
    // Descriptions are not searchable — the query targets names only.
    expect(skillMatches(SKILLS[0], "workflow")).toBe(false);
  });
});

describe("atEntriesFor", () => {
  const files = ["src/services/skill.ts", "src/features/commands/skills.ts"];

  it("lists matching skills first, then all files", () => {
    const entries = atEntriesFor(SKILLS, files, "research");
    expect(entries).toEqual([
      { kind: "skill", name: "research", description: "Deep research workflow" },
      { kind: "file", path: "src/services/skill.ts" },
      { kind: "file", path: "src/features/commands/skills.ts" },
    ]);
  });

  it("omits the skills group when nothing matches", () => {
    const entries = atEntriesFor(SKILLS, files, "zzz");
    expect(entries).toEqual([
      { kind: "file", path: "src/services/skill.ts" },
      { kind: "file", path: "src/features/commands/skills.ts" },
    ]);
  });

  it("keeps skill rows without a description", () => {
    const entries = atEntriesFor(SKILLS, [], "sql");
    expect(entries).toEqual([{ kind: "skill", name: "sql-analyzer" }]);
  });

  it("returns an empty list for an empty match on both groups", () => {
    expect(atEntriesFor([], [], "x")).toEqual([]);
  });
});

describe("atInsertText", () => {
  it("inserts @name for a skill and @path for a file", () => {
    expect(atInsertText({ kind: "skill", name: "research" })).toBe("@research");
    expect(atInsertText({ kind: "file", path: "src/find.ts" })).toBe("@src/find.ts");
  });
});
