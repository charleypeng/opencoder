// L1 tests for the haptics facade (TASK-M7-07): the pure kind -> pattern
// mapping (send light / complete success / permission warning / error
// error), the dispatch through the official haptics plugin guest API, and
// the double no-op guard — outside Tauri (no __TAURI_INTERNALS__) nothing
// is invoked at all, and inside Tauri on DESKTOP nothing is invoked either
// (the plugin's Rust side is a no-op there, so an IPC roundtrip would be
// pure waste). Only Tauri + mobile actually fires the native feedback.

import { afterEach, describe, expect, it, vi } from "vitest";
import { haptic, hapticPlan, isHapticsActive } from "./haptics";
import { refreshPlatform } from "../platform/index.js";

const { impactMock, notificationMock } = vi.hoisted(() => ({
  impactMock: vi.fn(),
  notificationMock: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-haptics", () => ({
  impactFeedback: impactMock,
  notificationFeedback: notificationMock,
}));

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const ORIGINAL_UA = window.navigator.userAgent;

function withTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

function withoutTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, configurable: true });
}

function withMobilePlatform(): void {
  Object.defineProperty(window.navigator, "userAgent", { value: IPHONE_UA, configurable: true });
  refreshPlatform();
}

function withDesktopPlatform(): void {
  Object.defineProperty(window.navigator, "userAgent", { value: MAC_UA, configurable: true });
  refreshPlatform();
}

afterEach(() => {
  vi.clearAllMocks();
  withoutTauri();
  Object.defineProperty(window.navigator, "userAgent", {
    value: ORIGINAL_UA,
    configurable: true,
  });
  refreshPlatform();
});

describe("hapticPlan", () => {
  it("maps the four kinds to the plugin patterns", () => {
    expect(hapticPlan("send")).toEqual({ command: "impact", arg: "light" });
    expect(hapticPlan("complete")).toEqual({ command: "notification", arg: "success" });
    expect(hapticPlan("permission")).toEqual({ command: "notification", arg: "warning" });
    expect(hapticPlan("error")).toEqual({ command: "notification", arg: "error" });
  });
});

describe("haptic dispatch", () => {
  it("is inactive outside Tauri", () => {
    withoutTauri();
    withMobilePlatform();
    expect(isHapticsActive()).toBe(false);
  });

  it("is inactive on the desktop platform", () => {
    withTauri();
    withDesktopPlatform();
    expect(isHapticsActive()).toBe(false);
  });

  it("is active on Tauri mobile", () => {
    withTauri();
    withMobilePlatform();
    expect(isHapticsActive()).toBe(true);
  });

  it("does not invoke the plugin outside Tauri", async () => {
    withoutTauri();
    withMobilePlatform();
    await haptic("send");
    expect(impactMock).not.toHaveBeenCalled();
  });

  it("does not invoke the plugin on the desktop platform", async () => {
    withTauri();
    withDesktopPlatform();
    await haptic("error");
    expect(notificationMock).not.toHaveBeenCalled();
  });

  it("fires impact light for a send", async () => {
    withTauri();
    withMobilePlatform();
    impactMock.mockResolvedValue({ status: "ok" });
    await haptic("send");
    expect(impactMock).toHaveBeenCalledWith("light");
  });

  it("fires the matching notification feedback for complete/permission/error", async () => {
    withTauri();
    withMobilePlatform();
    notificationMock.mockResolvedValue({ status: "ok" });
    await haptic("complete");
    expect(notificationMock).toHaveBeenCalledWith("success");
    notificationMock.mockClear();
    await haptic("permission");
    expect(notificationMock).toHaveBeenCalledWith("warning");
    notificationMock.mockClear();
    await haptic("error");
    expect(notificationMock).toHaveBeenCalledWith("error");
  });

  it("swallows plugin rejections (fire-and-forget)", async () => {
    withTauri();
    withMobilePlatform();
    impactMock.mockRejectedValue(new Error("no haptics"));
    await expect(haptic("send")).resolves.toBeUndefined();
  });
});
