// L1 tests for the QuickOpen result ranking (TASK-M4-04): prefix matches
// before substring matches before the server's other fuzzy matches, recent
// files first inside each bucket (most recent first), server order kept
// for the rest, and case-insensitive matching.

import { describe, expect, it } from "vitest";
import { rankResults } from "./rankResults";

describe("rankResults", () => {
  it("puts path prefixes before substrings before other fuzzy matches", () => {
    const ranked = rankResults("read", ["src/readme.md", "readme.md", "README.txt", "reeds.js"]);
    expect(ranked.map((entry) => entry.path)).toEqual([
      "readme.md", // prefix
      "README.txt", // prefix (case-insensitive)
      "src/readme.md", // substring
      "reeds.js", // fuzzy (no "read" anywhere)
    ]);
    expect(ranked.map((entry) => entry.bucket)).toEqual([0, 0, 1, 2]);
  });

  it("ranks recent files first inside the same bucket, most recent first", () => {
    const recent = ["README.txt", "src/readme.md"]; // most recent first
    const ranked = rankResults("read", ["zzz.ts", "src/readme.md", "README.txt"], recent);
    expect(ranked.map((entry) => entry.path)).toEqual([
      "README.txt", // bucket 0 (prefix), most recent
      "src/readme.md", // bucket 1 (substring), second most recent
      "zzz.ts", // bucket 2 (fuzzy), not recent
    ]);
  });

  it("keeps server order within a bucket for non-recent matches", () => {
    const ranked = rankResults("app", ["src/app/one.ts", "src/app/two.ts", "app.ts"]);
    expect(ranked.map((entry) => entry.path)).toEqual([
      "app.ts",
      "src/app/one.ts",
      "src/app/two.ts",
    ]);
  });

  it("boosts a recent prefix match ahead of a non-recent one", () => {
    const ranked = rankResults("read", ["readme.md", "README.txt"], ["README.txt"]);
    expect(ranked.map((entry) => entry.path)).toEqual(["README.txt", "readme.md"]);
  });

  it("matches case-insensitively and ignores query whitespace", () => {
    const ranked = rankResults("  READ ", ["src/readme.md", "README.txt"]);
    expect(ranked.map((entry) => entry.path)).toEqual(["README.txt", "src/readme.md"]);
  });

  it("keeps all results for an empty query in recent order", () => {
    const ranked = rankResults("", ["b.ts", "a.ts"], ["a.ts"]);
    expect(ranked.map((entry) => entry.path)).toEqual(["a.ts", "b.ts"]);
    expect(ranked.every((entry) => entry.bucket === 0)).toBe(true);
  });

  it("marks entries with their recent index (-1 when not recent)", () => {
    const ranked = rankResults("a", ["a.ts", "b.ts"], ["b.ts"]);
    expect(ranked[0]).toMatchObject({ path: "a.ts", recentIndex: -1 });
    expect(ranked[1]).toMatchObject({ path: "b.ts", recentIndex: 0 });
  });
});
