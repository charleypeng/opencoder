// L1 tests for the per-server recent project memory (TASK-M2-03): push
// semantics (front, dedupe, cap), per-server keys and storage failure
// tolerance.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushRecentProject, readRecentProjects } from "./recentProjects";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("recentProjects", () => {
  it("starts empty and returns an empty list for unknown servers", () => {
    expect(readRecentProjects("srv-a")).toEqual([]);
  });

  it("pushes to the front and dedupes", () => {
    expect(pushRecentProject("srv-a", "/one")).toEqual(["/one"]);
    expect(pushRecentProject("srv-a", "/two")).toEqual(["/two", "/one"]);
    // Re-selecting a project moves it to the front without duplicates.
    expect(pushRecentProject("srv-a", "/one")).toEqual(["/one", "/two"]);
  });

  it("caps the list at five entries", () => {
    for (let i = 1; i <= 7; i += 1) {
      pushRecentProject("srv-a", `/dir-${i}`);
    }
    expect(readRecentProjects("srv-a")).toEqual(["/dir-7", "/dir-6", "/dir-5", "/dir-4", "/dir-3"]);
  });

  it("keeps recent lists per server isolated", () => {
    pushRecentProject("srv-a", "/alpha");
    pushRecentProject("srv-b", "/beta");
    expect(readRecentProjects("srv-a")).toEqual(["/alpha"]);
    expect(readRecentProjects("srv-b")).toEqual(["/beta"]);
  });

  it("survives storage failures", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const next = pushRecentProject("srv-a", "/one");
    expect(next).toEqual(["/one"]);
    setItem.mockRestore();

    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readRecentProjects("srv-a")).toEqual([]);
    getItem.mockRestore();
  });

  it("ignores malformed stored values", () => {
    localStorage.setItem("oc-recent-projects:srv-a", "{not json");
    expect(readRecentProjects("srv-a")).toEqual([]);
    localStorage.setItem("oc-recent-projects:srv-a", JSON.stringify(["/ok", 42, null]));
    expect(readRecentProjects("srv-a")).toEqual(["/ok"]);
  });
});
