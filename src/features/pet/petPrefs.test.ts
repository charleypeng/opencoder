// L1 tests for the pet window preference persistence (TASK-M8-07): the
// pet window's display settings (size/opacity/topmost/mute/dock/click-
// through) survive restarts via its own localStorage (oc-pet), and
// applyPetPrefs pushes the stored values into the Rust commands at mount
// (only stored fields — absent ones keep the window defaults).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPetPrefs, loadPetPrefs, savePetPrefs } from "./petPrefs.js";

const {
  setPetSizeMock,
  setPetOpacityMock,
  setPetTopmostMock,
  setPetMuteMock,
  setPetDockMock,
  setPetIgnoreMouseMock,
} = vi.hoisted(() => ({
  setPetSizeMock: vi.fn(async () => undefined),
  setPetOpacityMock: vi.fn(async () => undefined),
  setPetTopmostMock: vi.fn(async () => undefined),
  setPetMuteMock: vi.fn(async () => undefined),
  setPetDockMock: vi.fn(async () => undefined),
  setPetIgnoreMouseMock: vi.fn(async () => undefined),
}));

vi.mock("../../services/pet.js", () => ({
  setPetSize: setPetSizeMock,
  setPetOpacity: setPetOpacityMock,
  setPetTopmost: setPetTopmostMock,
  setPetMute: setPetMuteMock,
  setPetDock: setPetDockMock,
  setPetIgnoreMouse: setPetIgnoreMouseMock,
}));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("loadPetPrefs", () => {
  it("returns an empty object without stored prefs", () => {
    expect(loadPetPrefs()).toEqual({ selectedPackId: "dev.opencoder.byte" });
  });

  it("round-trips stored prefs", () => {
    savePetPrefs({
      size: 180,
      opacity: 0.7,
      topmost: false,
      mute: true,
      dock: false,
      clickThrough: true,
    });
    expect(loadPetPrefs()).toEqual({
      selectedPackId: "dev.opencoder.byte",
      size: 180,
      opacity: 0.7,
      topmost: false,
      mute: true,
      dock: false,
      clickThrough: true,
    });
  });

  it("drops malformed JSON", () => {
    localStorage.setItem("oc-pet", "not json{");
    expect(loadPetPrefs()).toEqual({});
  });

  it("drops non-object payloads and invalid field shapes", () => {
    localStorage.setItem("oc-pet", JSON.stringify([1, 2]));
    expect(loadPetPrefs()).toEqual({});
    localStorage.setItem(
      "oc-pet",
      JSON.stringify({ size: "big", opacity: "full", topmost: 1, mute: "yes", dock: 0 }),
    );
    expect(loadPetPrefs()).toEqual({ selectedPackId: "dev.opencoder.byte" });
  });

  it("clamps out-of-range numbers into the settings range", () => {
    localStorage.setItem("oc-pet", JSON.stringify({ size: 40, opacity: 3 }));
    expect(loadPetPrefs()).toEqual({ selectedPackId: "dev.opencoder.byte", size: 120, opacity: 1 });
    localStorage.setItem("oc-pet", JSON.stringify({ size: 900, opacity: 0.1 }));
    expect(loadPetPrefs()).toEqual({
      selectedPackId: "dev.opencoder.byte",
      size: 200,
      opacity: 0.4,
    });
  });

  it("migrates every legacy type to the matching pack without dropping display prefs", () => {
    localStorage.setItem("oc-pet", JSON.stringify({ petType: "cat", size: 180, dock: false }));
    expect(loadPetPrefs()).toEqual({
      selectedPackId: "dev.opencoder.box-cat",
      size: 180,
      dock: false,
    });
    localStorage.setItem("oc-pet", JSON.stringify({ petType: "robot" }));
    expect(loadPetPrefs().selectedPackId).toBe("dev.opencoder.byte");
  });
});

describe("applyPetPrefs", () => {
  it("applies every stored field to its command", async () => {
    savePetPrefs({
      size: 170,
      opacity: 0.8,
      topmost: false,
      mute: true,
      dock: false,
      clickThrough: true,
    });
    await applyPetPrefs();
    expect(setPetSizeMock).toHaveBeenCalledWith(170);
    expect(setPetOpacityMock).toHaveBeenCalledWith(0.8);
    expect(setPetTopmostMock).toHaveBeenCalledWith(false);
    expect(setPetMuteMock).toHaveBeenCalledWith(true);
    expect(setPetDockMock).toHaveBeenCalledWith(false);
    expect(setPetIgnoreMouseMock).toHaveBeenCalledWith(true);
  });

  it("applies nothing without stored prefs", async () => {
    await applyPetPrefs();
    expect(setPetSizeMock).not.toHaveBeenCalled();
    expect(setPetOpacityMock).not.toHaveBeenCalled();
    expect(setPetTopmostMock).not.toHaveBeenCalled();
    expect(setPetMuteMock).not.toHaveBeenCalled();
    expect(setPetDockMock).not.toHaveBeenCalled();
    expect(setPetIgnoreMouseMock).not.toHaveBeenCalled();
  });

  it("applies only the stored subset", async () => {
    savePetPrefs({ size: 150 });
    await applyPetPrefs();
    expect(setPetSizeMock).toHaveBeenCalledWith(150);
    expect(setPetOpacityMock).not.toHaveBeenCalled();
    expect(setPetTopmostMock).not.toHaveBeenCalled();
    expect(setPetMuteMock).not.toHaveBeenCalled();
    expect(setPetDockMock).not.toHaveBeenCalled();
    expect(setPetIgnoreMouseMock).not.toHaveBeenCalled();
  });
});
