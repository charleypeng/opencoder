// L1 tests for the search result helpers (TASK-M4-05): groupByFile buckets
// matches by path in first-seen order and highlightSpans prefers the
// server's submatches (clamped to the line, empty spans dropped) before
// falling back to a client-side first match of the searched pattern —
// case-insensitive literal or regex — with null results for bad patterns.

import { describe, expect, it } from "vitest";
import type { FindMatch } from "../../services/find.js";
import { firstOccurrence, groupByFile, highlightSpans } from "./searchResults.js";

function match(
  path: string,
  line: string,
  lineNumber: number,
  submatches: FindMatch["submatches"] = [],
): FindMatch {
  return {
    path: { text: path },
    lines: { text: line },
    line_number: lineNumber,
    absolute_offset: 0,
    submatches,
  };
}

describe("groupByFile", () => {
  it("groups by path, preserving first-seen order", () => {
    const groups = groupByFile([
      match("b.ts", "x", 1),
      match("a.ts", "x", 1),
      match("b.ts", "y", 2),
      match("c.ts", "z", 1),
    ]);
    expect(groups.map((g) => g.path)).toEqual(["b.ts", "a.ts", "c.ts"]);
    expect(groups[0].matches.map((m) => m.line_number)).toEqual([1, 2]);
    expect(groups[1].matches.map((m) => m.line_number)).toEqual([1]);
  });

  it("returns an empty list for no matches", () => {
    expect(groupByFile([])).toEqual([]);
  });
});

describe("highlightSpans", () => {
  it("uses the server submatches when present", () => {
    const m = match("a.ts", "const value = 42;", 1, [
      { match: { text: "value" }, start: 6, end: 11 },
    ]);
    expect(highlightSpans(m, "zzz", false)).toEqual([{ start: 6, end: 11 }]);
  });

  it("clamps submatches to the line length and drops empty spans", () => {
    const m = match("a.ts", "short", 1, [
      { match: { text: "over" }, start: 2, end: 99 },
      { match: { text: "" }, start: 99, end: 99 },
    ]);
    expect(highlightSpans(m, "zzz", false)).toEqual([{ start: 2, end: 5 }]);
  });

  it("falls back to a case-insensitive literal first match", () => {
    const m = match("a.ts", "const Value = 42;", 1);
    expect(highlightSpans(m, "value", false)).toEqual([{ start: 6, end: 11 }]);
  });

  it("falls back to a regex first match", () => {
    const m = match("a.ts", "const createSignal = 1;", 1);
    expect(highlightSpans(m, "create\\w+", true)).toEqual([{ start: 6, end: 18 }]);
  });

  it("returns no spans when the pattern does not match", () => {
    const m = match("a.ts", "const x = 1;", 1);
    expect(highlightSpans(m, "zzz", false)).toEqual([]);
    expect(highlightSpans(m, "zzz+", true)).toEqual([]);
  });

  it("returns no spans for an invalid regex pattern", () => {
    const m = match("a.ts", "const x = 1;", 1);
    expect(highlightSpans(m, "((", true)).toEqual([]);
  });

  it("returns no spans for an empty pattern", () => {
    const m = match("a.ts", "const x = 1;", 1);
    expect(highlightSpans(m, "", false)).toEqual([]);
  });
});

describe("firstOccurrence", () => {
  it("finds a literal match case-insensitively", () => {
    expect(firstOccurrence("Hello World", "world", false)).toEqual({ start: 6, end: 11 });
    expect(firstOccurrence("Hello World", "nope", false)).toBeNull();
  });

  it("finds a regex match with the pattern as-is", () => {
    expect(firstOccurrence("call createSignal(1)", "create\\w+", true)).toEqual({
      start: 5,
      end: 17,
    });
    expect(firstOccurrence("plain text", "\\d+", true)).toBeNull();
  });
});
