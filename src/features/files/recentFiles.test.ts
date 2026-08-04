// L1 tests for the per-server recent file memory (TASK-M4-04): push
// semantics (front, dedupe, cap at 20), per-server keys and storage
// failure tolerance.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushRecentFile, readRecentFiles } from "./recentFiles";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("recentFiles", () => {
  it("starts empty and returns an empty list for unknown servers", () => {
    expect(readRecentFiles("srv-a")).toEqual([]);
  });

  it("pushes to the front and dedupes", () => {
    expect(pushRecentFile("srv-a", "/one")).toEqual(["/one"]);
    expect(pushRecentFile("srv-a", "/two")).toEqual(["/two", "/one"]);
    // Re-opening a file moves it to the front without duplicates.
    expect(pushRecentFile("srv-a", "/one")).toEqual(["/one", "/two"]);
  });

  it("caps the list at twenty entries", () => {
    for (let i = 1; i <= 25; i += 1) {
      pushRecentFile("srv-a", `/file-${i}.ts`);
    }
    const recent = readRecentFiles("srv-a");
    expect(recent).toHaveLength(20);
    expect(recent[0]).toBe("/file-25.ts");
    expect(recent[19]).toBe("/file-6.ts");
  });

  it("keeps recent lists per server isolated", () => {
    pushRecentFile("srv-a", "/alpha.ts");
    pushRecentFile("srv-b", "/beta.ts");
    expect(readRecentFiles("srv-a")).toEqual(["/alpha.ts"]);
    expect(readRecentFiles("srv-b")).toEqual(["/beta.ts"]);
  });

  it("survives storage failures", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const next = pushRecentFile("srv-a", "/one.ts");
    expect(next).toEqual(["/one.ts"]);
    setItem.mockRestore();

    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readRecentFiles("srv-a")).toEqual([]);
    getItem.mockRestore();
  });

  it("ignores malformed stored values", () => {
    localStorage.setItem("oc-recent-files:srv-a", "{not json");
    expect(readRecentFiles("srv-a")).toEqual([]);
    localStorage.setItem("oc-recent-files:srv-a", JSON.stringify(["/ok.ts", 42, null]));
    expect(readRecentFiles("srv-a")).toEqual(["/ok.ts"]);
  });
});
