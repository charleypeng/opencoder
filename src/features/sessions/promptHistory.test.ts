// L1 tests for the prompt history module (TASK-M2-08): most-recent-first
// recall order, immediate-repeat dedupe, the 20-entry cap, per-server
// isolation and clearing.

import { afterEach, describe, expect, it } from "vitest";
import { clearPrompts, promptAt, pushPrompt, readPrompts } from "./promptHistory";

afterEach(() => clearPrompts("srv-history"));

describe("promptHistory", () => {
  it("recalls prompts most recent first", () => {
    pushPrompt("srv-history", "first");
    pushPrompt("srv-history", "second");

    expect(readPrompts("srv-history")).toEqual(["second", "first"]);
    expect(promptAt("srv-history", 0)).toBe("second");
    expect(promptAt("srv-history", 1)).toBe("first");
  });

  it("dedupes repeated prompts without losing order", () => {
    pushPrompt("srv-history", "a");
    pushPrompt("srv-history", "b");
    pushPrompt("srv-history", "a");

    expect(readPrompts("srv-history")).toEqual(["a", "b"]);
  });

  it("caps the history at 20 entries", () => {
    for (let i = 0; i < 25; i += 1) pushPrompt("srv-history", `p${i}`);

    expect(readPrompts("srv-history")).toHaveLength(20);
    expect(promptAt("srv-history", 0)).toBe("p24");
    expect(promptAt("srv-history", 19)).toBe("p5");
    expect(promptAt("srv-history", 20)).toBeUndefined();
  });

  it("keeps per-server histories isolated", () => {
    pushPrompt("srv-history", "server-a");
    pushPrompt("srv-other", "server-b");

    expect(readPrompts("srv-history")).toEqual(["server-a"]);
    expect(readPrompts("srv-other")).toEqual(["server-b"]);
  });

  it("clears a server's history", () => {
    pushPrompt("srv-history", "a");
    clearPrompts("srv-history");

    expect(readPrompts("srv-history")).toEqual([]);
    expect(promptAt("srv-history", 0)).toBeUndefined();
  });

  it("returns an empty list for unknown servers", () => {
    expect(readPrompts("srv-none")).toEqual([]);
    expect(promptAt("srv-none", 0)).toBeUndefined();
  });
});
