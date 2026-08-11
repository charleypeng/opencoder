// L1 tests for the UI scale store: the default (bigger-by-default 1.1),
// clamping + step snapping, persistence, the immediate application to the
// --ui-scale CSS variable, and the mobile exemption (mobile always writes
// 1 so the native glass tab bar coordination never scales).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPlatform } from "../platform/index.js";
import {
  DEFAULT_UI_SCALE,
  UI_SCALE_KEY,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  applyUiScale,
  clampScale,
  setUiScale,
  uiScale,
} from "./uiScale.js";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

function scaleVar(): string {
  return document.documentElement.style.getPropertyValue("--ui-scale");
}

function toMobile() {
  Object.defineProperty(window.navigator, "userAgent", {
    value: IPHONE_UA,
    configurable: true,
  });
  refreshPlatform();
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    configurable: true,
  });
  refreshPlatform();
  document.documentElement.style.removeProperty("--ui-scale");
});

afterEach(() => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    configurable: true,
  });
  refreshPlatform();
});

describe("uiScale store", () => {
  it("defaults to 1.1 (bigger-by-default desktop baseline) without a stored value", () => {
    expect(uiScale()).toBe(DEFAULT_UI_SCALE);
    applyUiScale();
    expect(scaleVar()).toBe("1.1");
  });

  it("sets the scale, applies it to the CSS variable immediately and persists it", () => {
    setUiScale(1.4);
    expect(uiScale()).toBe(1.4);
    expect(scaleVar()).toBe("1.4");
    expect(localStorage.getItem(UI_SCALE_KEY)).toBe("1.4");
  });

  it("clamps out-of-range values and snaps to the 0.05 step", () => {
    expect(clampScale(2.0)).toBe(UI_SCALE_MAX);
    expect(clampScale(0.2)).toBe(UI_SCALE_MIN);
    expect(clampScale(1.12)).toBe(1.1);
    expect(clampScale(Number.NaN)).toBe(DEFAULT_UI_SCALE);
    setUiScale(5);
    expect(uiScale()).toBe(UI_SCALE_MAX);
    expect(scaleVar()).toBe("1.6");
  });

  it("reads a persisted value on startup (through the signal initializer)", async () => {
    localStorage.setItem(UI_SCALE_KEY, "1.25");
    vi.resetModules();
    const fresh = await import("./uiScale.js");
    expect(fresh.uiScale()).toBe(1.25);
    fresh.applyUiScale();
    expect(scaleVar()).toBe("1.25");
  });

  it("falls back to the default for a malformed persisted value", async () => {
    localStorage.setItem(UI_SCALE_KEY, "huge");
    vi.resetModules();
    const fresh = await import("./uiScale.js");
    expect(fresh.uiScale()).toBe(DEFAULT_UI_SCALE);
  });

  it("keeps the interface at scale 1 on mobile even when a scale is stored", () => {
    toMobile();
    localStorage.setItem(UI_SCALE_KEY, "1.3");
    applyUiScale();
    expect(scaleVar()).toBe("1");
    // The stored value still survives (a later desktop session sees it),
    // but the mobile surface never zooms.
    setUiScale(1.5);
    expect(scaleVar()).toBe("1");
    expect(localStorage.getItem(UI_SCALE_KEY)).toBe("1.5");
  });
});
