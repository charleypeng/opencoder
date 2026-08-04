// L1 tests for the desktop preference persistence (TASK-M8-05): the
// close-to-tray flag and the custom summon accelerator survive restarts
// via localStorage (oc-desktop), and applyDesktopPrefs pushes stored
// prefs into the Rust commands at shell mount (skipping the default
// accelerator and anything that failed to parse).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDesktopPrefs,
  loadDesktopPrefs,
  petEnabled,
  saveDesktopPrefs,
  setPetEnabled,
} from "./desktopPrefs.js";
import { DEFAULT_SUMMON_SHORTCUT } from "../../services/tray.js";

const { setCloseToTrayMock, setGlobalShortcutMock, showPetMock, hidePetMock } = vi.hoisted(() => ({
  setCloseToTrayMock: vi.fn(async () => undefined),
  setGlobalShortcutMock: vi.fn(async (accelerator: string) => accelerator),
  showPetMock: vi.fn(async () => undefined),
  hidePetMock: vi.fn(async () => undefined),
}));
vi.mock("../../services/tray.js", () => ({
  setCloseToTray: setCloseToTrayMock,
  setGlobalShortcut: setGlobalShortcutMock,
  DEFAULT_SUMMON_SHORTCUT: "Alt+Space",
}));
vi.mock("../../services/pet.js", () => ({
  showPet: showPetMock,
  hidePet: hidePetMock,
}));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("loadDesktopPrefs", () => {
  it("returns an empty object without stored prefs", () => {
    expect(loadDesktopPrefs()).toEqual({});
  });

  it("round-trips stored prefs", () => {
    saveDesktopPrefs({ closeToTray: true, globalShortcut: "Ctrl+Shift+O" });
    expect(loadDesktopPrefs()).toEqual({ closeToTray: true, globalShortcut: "Ctrl+Shift+O" });
  });

  it("drops malformed JSON", () => {
    localStorage.setItem("oc-desktop", "not json{");
    expect(loadDesktopPrefs()).toEqual({});
  });

  it("drops non-object payloads and invalid field shapes", () => {
    localStorage.setItem("oc-desktop", JSON.stringify([1, 2]));
    expect(loadDesktopPrefs()).toEqual({});
    localStorage.setItem("oc-desktop", JSON.stringify({ closeToTray: "yes", globalShortcut: 7 }));
    expect(loadDesktopPrefs()).toEqual({});
  });

  it("drops an empty shortcut string", () => {
    localStorage.setItem("oc-desktop", JSON.stringify({ globalShortcut: "  " }));
    expect(loadDesktopPrefs()).toEqual({});
  });
});

describe("applyDesktopPrefs", () => {
  it("applies a stored close-to-tray flag", async () => {
    saveDesktopPrefs({ closeToTray: true });
    await applyDesktopPrefs();
    expect(setCloseToTrayMock).toHaveBeenCalledWith(true);
  });

  it("applies a stored custom accelerator", async () => {
    saveDesktopPrefs({ globalShortcut: "Ctrl+Shift+O" });
    await applyDesktopPrefs();
    expect(setGlobalShortcutMock).toHaveBeenCalledWith("Ctrl+Shift+O");
  });

  it("skips the default accelerator (already registered at startup)", async () => {
    saveDesktopPrefs({ globalShortcut: DEFAULT_SUMMON_SHORTCUT });
    await applyDesktopPrefs();
    expect(setGlobalShortcutMock).not.toHaveBeenCalled();
  });

  it("does nothing without stored prefs", async () => {
    await applyDesktopPrefs();
    expect(setCloseToTrayMock).not.toHaveBeenCalled();
    expect(setGlobalShortcutMock).not.toHaveBeenCalled();
  });
});

describe("petEnabled / setPetEnabled (TASK-M8-07)", () => {
  it("defaults the pet to enabled", () => {
    expect(petEnabled()).toBe(true);
  });

  it("is off only when the pref explicitly says so", () => {
    saveDesktopPrefs({ petEnabled: false });
    expect(petEnabled()).toBe(false);
    saveDesktopPrefs({ petEnabled: true });
    expect(petEnabled()).toBe(true);
  });

  it("round-trips the petEnabled field through the store", () => {
    saveDesktopPrefs({ petEnabled: false });
    expect(loadDesktopPrefs()).toEqual({ petEnabled: false });
    // Invalid shapes are dropped at load.
    saveDesktopPrefs({ petEnabled: "yes" } as unknown as { petEnabled: boolean });
    expect(loadDesktopPrefs()).toEqual({});
  });

  it("shows the pet and persists the pref when enabled", async () => {
    await setPetEnabled(true);
    expect(showPetMock).toHaveBeenCalledTimes(1);
    expect(hidePetMock).not.toHaveBeenCalled();
    expect(loadDesktopPrefs().petEnabled).toBe(true);
    expect(petEnabled()).toBe(true);
  });

  it("hides the pet and persists the pref when disabled", async () => {
    await setPetEnabled(false);
    expect(hidePetMock).toHaveBeenCalledTimes(1);
    expect(showPetMock).not.toHaveBeenCalled();
    expect(loadDesktopPrefs().petEnabled).toBe(false);
    expect(petEnabled()).toBe(false);
  });

  it("keeps the stored pref when the window action fails", async () => {
    saveDesktopPrefs({ petEnabled: true });
    hidePetMock.mockRejectedValueOnce(new Error("pet unavailable"));
    await expect(setPetEnabled(false)).rejects.toThrow("pet unavailable");
    expect(loadDesktopPrefs().petEnabled).toBe(true);
  });
});
