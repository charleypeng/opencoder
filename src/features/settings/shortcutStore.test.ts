// L1 tests for the shortcut customization store (TASK-M8-01): persistence
// through localStorage, load-time validation (malformed combos and unknown
// ids dropped), save / per-row reset / reset-all, and the effective-combo
// fallback to the default table.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { combo } from "./shortcuts";

const STORAGE_KEY = "oc-shortcuts";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("shortcutStore", () => {
  it("starts from the default table when nothing is stored", async () => {
    const store = await import("./shortcutStore.js");
    expect(store.effectiveCombo("quickOpen")).toEqual(combo("p"));
    expect(store.effectiveCombo("fullTextSearch")).toEqual(combo("f", { shift: true }));
    expect(store.isCustomized("quickOpen")).toBe(false);
  });

  it("saves a customization and persists it to localStorage", async () => {
    const store = await import("./shortcutStore.js");
    const custom = combo("e");
    store.saveShortcutCombo("quickOpen", custom);

    expect(store.overrides.quickOpen).toEqual(custom);
    expect(store.effectiveCombo("quickOpen")).toEqual(custom);
    expect(store.isCustomized("quickOpen")).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({ quickOpen: custom });
  });

  it("loads valid stored overrides and drops malformed or unknown entries", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        quickOpen: { key: "e", ctrl: true, meta: false, shift: false, alt: false },
        // Unknown shortcut id: dropped.
        bogusId: { key: "x", ctrl: true, meta: false, shift: false, alt: false },
        // Malformed combo: dropped.
        newSession: { key: "n" },
        // Non-object payload: dropped.
        prevSession: "Ctrl+[",
      }),
    );
    vi.resetModules();
    const store = await import("./shortcutStore.js");

    expect(store.effectiveCombo("quickOpen")).toEqual(combo("e"));
    expect(store.effectiveCombo("newSession")).toEqual(combo("n"));
    expect(store.effectiveCombo("prevSession")).toEqual(combo("["));
  });

  it("survives a module reload (customization persists across restarts)", async () => {
    const first = await import("./shortcutStore.js");
    first.saveShortcutCombo("toggleTerminal", combo("t"));
    vi.resetModules();

    const second = await import("./shortcutStore.js");
    expect(second.effectiveCombo("toggleTerminal")).toEqual(combo("t"));
  });

  it("resets a single shortcut back to its default", async () => {
    const store = await import("./shortcutStore.js");
    store.saveShortcutCombo("quickOpen", combo("e"));
    store.resetShortcutCombo("quickOpen");

    expect(store.isCustomized("quickOpen")).toBe(false);
    expect(store.effectiveCombo("quickOpen")).toEqual(combo("p"));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({});
  });

  it("reset-all clears every customization and the storage", async () => {
    const store = await import("./shortcutStore.js");
    store.saveShortcutCombo("quickOpen", combo("e"));
    store.saveShortcutCombo("newSession", combo("m"));
    store.resetAllShortcuts();

    expect(store.overrides.quickOpen).toBeUndefined();
    expect(store.effectiveCombo("quickOpen")).toEqual(combo("p"));
    expect(store.effectiveCombo("newSession")).toEqual(combo("n"));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("{}");
  });

  it("tolerates unreadable storage", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    vi.resetModules();
    const store = await import("./shortcutStore.js");
    expect(store.effectiveCombo("quickOpen")).toEqual(combo("p"));
  });
});
