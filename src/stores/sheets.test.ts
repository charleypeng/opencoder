// L1 tests for the open-sheet registry (TASK-M7-10): registration and
// removal, top-sheet ordering (most recently opened wins), and the
// dismiss-only closeTopSheet — pinned sheets are never closed by the
// system back.

import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTopSheet, registerSheet, resetSheets, topSheet } from "./sheets";

afterEach(() => {
  resetSheets();
});

describe("sheets registry", () => {
  it("tracks open sheets in registration order", () => {
    const a = { id: "a", dismissible: true, close: vi.fn() };
    const b = { id: "b", dismissible: true, close: vi.fn() };
    registerSheet("a", a);
    expect(topSheet()).toEqual(a);
    registerSheet("b", b);
    expect(topSheet()).toEqual(b);
  });

  it("removes a sheet on null registration", () => {
    const a = { id: "a", dismissible: true, close: vi.fn() };
    registerSheet("a", a);
    registerSheet("a", null);
    expect(topSheet()).toBeNull();
  });

  it("keeps the top sheet after a lower sheet closes", () => {
    const a = { id: "a", dismissible: true, close: vi.fn() };
    const b = { id: "b", dismissible: true, close: vi.fn() };
    registerSheet("a", a);
    registerSheet("b", b);
    registerSheet("b", null);
    expect(topSheet()).toEqual(a);
  });

  it("re-registration moves the sheet to the top", () => {
    const a = { id: "a", dismissible: true, close: vi.fn() };
    const b = { id: "b", dismissible: true, close: vi.fn() };
    registerSheet("a", a);
    registerSheet("b", b);
    registerSheet("a", a);
    expect(topSheet()).toEqual(a);
  });

  it("closeTopSheet closes only a dismissible top sheet", () => {
    const close = vi.fn();
    registerSheet("pinned", { id: "pinned", dismissible: false, close });
    closeTopSheet();
    expect(close).not.toHaveBeenCalled();
    expect(topSheet()).not.toBeNull();

    registerSheet("open", { id: "open", dismissible: true, close });
    closeTopSheet();
    expect(close).toHaveBeenCalledTimes(1);
    // Closing does not auto-remove the entry (the sheet owns its life).
    expect(topSheet()?.id).toBe("open");
  });

  it("closeTopSheet is a no-op with no sheet open", () => {
    expect(closeTopSheet()).toBeUndefined();
  });
});
