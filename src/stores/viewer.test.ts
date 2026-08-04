// L1 tests for the viewer store (TASK-M4-03): per-server open file tabs —
// opening appends + activates (no duplicates), explicit names win over the
// basename, closing the active tab activates the left neighbor (or the
// tab that slid into its place), activation only touches open tabs, and
// servers stay isolated with resetServer dropping only its own bucket.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeTab,
  getServerViewer,
  openTab,
  resetServer,
  setActive,
  tabNameOf,
  viewer,
} from "./viewer.js";

const SERVER = "srv-viewer";
const OTHER = "srv-viewer-other";

beforeEach(() => {
  resetServer(SERVER);
  resetServer(OTHER);
});

afterEach(() => {
  resetServer(SERVER);
  resetServer(OTHER);
});

describe("tabNameOf", () => {
  it("derives the basename of a slash path", () => {
    expect(tabNameOf("src/App.tsx")).toBe("App.tsx");
    expect(tabNameOf("README.md")).toBe("README.md");
    expect(tabNameOf("/")).toBe("/");
  });
});

describe("viewer store actions", () => {
  it("starts with no per-server bucket", () => {
    expect(viewer[SERVER]).toBeUndefined();
    expect(getServerViewer(SERVER)).toBeUndefined();
  });

  it("openTab appends a tab with the basename and activates it", () => {
    openTab(SERVER, "src/App.tsx");
    expect(viewer[SERVER].tabs).toEqual([{ path: "src/App.tsx", name: "App.tsx" }]);
    expect(viewer[SERVER].activePath).toBe("src/App.tsx");
  });

  it("openTab honors an explicit name", () => {
    openTab(SERVER, "src/index.ts", "Index");
    expect(viewer[SERVER].tabs).toEqual([{ path: "src/index.ts", name: "Index" }]);
  });

  it("openTab on an already-open path only activates it (no duplicate)", () => {
    openTab(SERVER, "a.ts");
    openTab(SERVER, "b.ts");
    openTab(SERVER, "a.ts");
    expect(viewer[SERVER].tabs.map((t) => t.path)).toEqual(["a.ts", "b.ts"]);
    expect(viewer[SERVER].activePath).toBe("a.ts");
  });

  it("openTab ignores an empty path", () => {
    openTab(SERVER, "");
    expect(viewer[SERVER]).toBeUndefined();
  });

  it("closeTab removes an inactive tab and keeps the active one", () => {
    openTab(SERVER, "a.ts");
    openTab(SERVER, "b.ts");
    openTab(SERVER, "c.ts");
    setActive(SERVER, "c.ts");
    closeTab(SERVER, "a.ts");
    expect(viewer[SERVER].tabs.map((t) => t.path)).toEqual(["b.ts", "c.ts"]);
    expect(viewer[SERVER].activePath).toBe("c.ts");
  });

  it("closing the active tab activates the left neighbor", () => {
    openTab(SERVER, "a.ts");
    openTab(SERVER, "b.ts");
    openTab(SERVER, "c.ts");
    closeTab(SERVER, "c.ts");
    expect(viewer[SERVER].tabs.map((t) => t.path)).toEqual(["a.ts", "b.ts"]);
    expect(viewer[SERVER].activePath).toBe("b.ts");
  });

  it("closing the active first tab activates the tab that slid into place", () => {
    openTab(SERVER, "a.ts");
    openTab(SERVER, "b.ts");
    closeTab(SERVER, "a.ts");
    expect(viewer[SERVER].tabs.map((t) => t.path)).toEqual(["b.ts"]);
    expect(viewer[SERVER].activePath).toBe("b.ts");
  });

  it("closing the last tab leaves an empty bucket with no active path", () => {
    openTab(SERVER, "a.ts");
    closeTab(SERVER, "a.ts");
    expect(viewer[SERVER].tabs).toEqual([]);
    expect(viewer[SERVER].activePath).toBeNull();
  });

  it("closeTab ignores unknown paths", () => {
    openTab(SERVER, "a.ts");
    closeTab(SERVER, "nope.ts");
    expect(viewer[SERVER].tabs.map((t) => t.path)).toEqual(["a.ts"]);
    expect(viewer[SERVER].activePath).toBe("a.ts");
  });

  it("setActive switches the viewed tab and ignores unknown paths", () => {
    openTab(SERVER, "a.ts");
    openTab(SERVER, "b.ts");
    setActive(SERVER, "b.ts");
    expect(viewer[SERVER].activePath).toBe("b.ts");
    setActive(SERVER, "nope.ts");
    expect(viewer[SERVER].activePath).toBe("b.ts");
  });

  it("keeps servers independent and resetServer drops only its own bucket", () => {
    openTab(SERVER, "a.ts");
    openTab(OTHER, "b.ts");
    expect(viewer[SERVER].tabs.map((t) => t.path)).toEqual(["a.ts"]);
    expect(viewer[OTHER].tabs.map((t) => t.path)).toEqual(["b.ts"]);

    resetServer(SERVER);
    expect(viewer[SERVER]).toBeUndefined();
    expect(viewer[OTHER].tabs.map((t) => t.path)).toEqual(["b.ts"]);
  });
});
