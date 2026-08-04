// L1 tests for the shared unified-diff helpers (TASK-M4-07): row
// classification, patch parsing with old/new line numbers tracked through
// hunk headers, context folding and split-view alignment.

import { describe, expect, it } from "vitest";
import {
  alignSplit,
  foldGroups,
  parseUnifiedDiff,
  rowKindOf,
  visibleLines,
  type DiffLine,
} from "./diffLines.js";

const PATCH = [
  "--- a/src/auth/login.ts",
  "+++ b/src/auth/login.ts",
  "@@ -1,4 +1,7 @@",
  ' import { auth } from "./api";',
  " const keep = true;",
  "-const gone = 1;",
  "+export const added = 2;",
  "+export const more = 3;",
  " const tail = 4;",
].join("\n");

describe("rowKindOf", () => {
  it("classifies add/del/ctx lines by prefix", () => {
    expect(rowKindOf("+added")).toBe("add");
    expect(rowKindOf("-removed")).toBe("del");
    expect(rowKindOf(" context")).toBe("ctx");
    expect(rowKindOf("")).toBe("ctx");
  });

  it("treats file headers and hunk lines as meta/hunk", () => {
    expect(rowKindOf("--- a/x")).toBe("meta");
    expect(rowKindOf("+++ b/x")).toBe("meta");
    expect(rowKindOf("diff --git a/x b/x")).toBe("meta");
    expect(rowKindOf("index 123..456 100644")).toBe("meta");
    expect(rowKindOf("new file mode 100644")).toBe("meta");
    expect(rowKindOf("@@ -1,2 +1,2 @@")).toBe("hunk");
    // `+++`-prefixed additions must never classify as add lines.
    expect(rowKindOf("+++not-a-header")).toBe("meta");
    expect(rowKindOf("---not-a-header")).toBe("meta");
  });
});

describe("parseUnifiedDiff", () => {
  it("parses rows with kinds and old/new line numbers", () => {
    const rows = parseUnifiedDiff(PATCH);
    expect(rows.map((row) => row.kind)).toEqual([
      "meta",
      "meta",
      "hunk",
      "ctx",
      "ctx",
      "del",
      "add",
      "add",
      "ctx",
    ]);
    expect(rows.map((row) => [row.oldLine, row.newLine])).toEqual([
      [null, null],
      [null, null],
      [null, null],
      [1, 1],
      [2, 2],
      [3, null],
      [null, 3],
      [null, 4],
      [4, 5],
    ]);
  });

  it("handles hunk headers without counts and new-file zero starts", () => {
    const rows = parseUnifiedDiff("--- a/new.ts\n+++ b/new.ts\n@@ -0,0 +1,4 @@\n+line1\n+line2\n");
    expect(rows.map((row) => [row.oldLine, row.newLine])).toEqual([
      [null, null],
      [null, null],
      [null, null],
      [null, 1],
      [null, 2],
    ]);

    const bare = parseUnifiedDiff("@@ -1 +1 @@\n- a\n+ b\n");
    expect(bare[1]).toMatchObject({ kind: "del", oldLine: 1, newLine: null });
    expect(bare[2]).toMatchObject({ kind: "add", oldLine: null, newLine: 1 });
  });

  it("leaves line numbers null when no hunk header precedes", () => {
    const rows = parseUnifiedDiff("-old\n+new\n");
    expect(rows.map((row) => row.oldLine)).toEqual([null, null]);
  });

  it("keeps unparsable hunk lines as hunk rows without crashing", () => {
    const rows = parseUnifiedDiff("@@ weird\n+ok\n");
    expect(rows[0]).toMatchObject({ kind: "hunk", oldLine: null, newLine: null });
    // No parsable header means no line numbers anywhere.
    expect(rows[1]).toMatchObject({ kind: "add", oldLine: null, newLine: null });
  });
});

describe("foldGroups", () => {
  function ctx(n: number): DiffLine[] {
    return Array.from({ length: n }, (_, i) => ({
      kind: "ctx" as const,
      oldLine: i + 1,
      newLine: i + 1,
      text: ` ctx ${i}`,
    }));
  }
  const add: DiffLine = { kind: "add", oldLine: null, newLine: 1, text: "+x" };
  const del: DiffLine = { kind: "del", oldLine: 1, newLine: null, text: "-x" };

  it("keeps runs of up to three context lines unfolded", () => {
    const groups = foldGroups([...ctx(3), add, ...ctx(1)]);
    expect(groups.map((group) => group.key)).toEqual([null, null, null, null, null]);
    expect(groups.every((group) => group.foldCount === 0)).toBe(true);
  });

  it("folds runs longer than three with a count and full run kept", () => {
    const groups = foldGroups([...ctx(6)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("fold-0");
    expect(groups[0].visible).toBe(3);
    expect(groups[0].foldCount).toBe(3);
    expect(groups[0].lines).toHaveLength(6);
    // Collapsed shows the visible slice only; expanded shows everything.
    expect(visibleLines(groups[0], false)).toHaveLength(3);
    expect(visibleLines(groups[0], true)).toHaveLength(6);
    // Ordinary groups ignore the expanded flag.
    expect(visibleLines(groups[0], false)[0].text).toBe(" ctx 0");
  });

  it("folds each run separately with stable sequential keys", () => {
    const groups = foldGroups([...ctx(5), add, ...ctx(7), del, ...ctx(2)]);
    const foldKeys = groups.filter((group) => group.key !== null).map((group) => group.key);
    expect(foldKeys).toEqual(["fold-0", "fold-1"]);
    // Non-context rows and the short trailing run stay unfolded (the short
    // run renders one group per row).
    expect(groups.filter((group) => group.foldCount === 0).length).toBe(4);
  });

  it("honors a custom max context", () => {
    const groups = foldGroups(ctx(4), 2);
    expect(groups[0]).toMatchObject({ visible: 2, foldCount: 2 });
  });
});

describe("alignSplit", () => {
  const rows = parseUnifiedDiff(PATCH);

  it("pairs context lines one-to-one and spans headers", () => {
    const split = alignSplit(rows);
    // meta/meta/hunk span rows, then ctx/ctx pair, del paired with first add.
    expect(split.slice(0, 3).every((row) => row.kind === "span")).toBe(true);
    expect(split[3]).toMatchObject({
      kind: "pair",
      old: { text: ' import { auth } from "./api";' },
      new: { text: ' import { auth } from "./api";' },
    });
    expect(split[5]).toMatchObject({
      kind: "pair",
      old: { text: "-const gone = 1;" },
      new: { text: "+export const added = 2;" },
    });
  });

  it("leaves the new side empty for a removed line without an add counterpart", () => {
    const split = alignSplit(parseUnifiedDiff("@@ -1,2 +1 @@\n ctx\n-const gone = 1;\n"));
    const last = split[split.length - 1];
    expect(last.kind).toBe("pair");
    expect(last.old?.kind).toBe("del");
    expect(last.new).toBeNull();
  });

  it("emits a null old cell for an add with no preceding del", () => {
    const split = alignSplit(parseUnifiedDiff("@@ -1 +1,2 @@\n ctx\n+added\n"));
    const last = split[split.length - 1];
    expect(last.kind).toBe("pair");
    expect(last.old).toBeNull();
    expect(last.new?.kind).toBe("add");
  });
});
