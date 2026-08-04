// L1 tests for the barcode scanner facade (TASK-M7-08): the double no-op
// guard — outside Tauri (no __TAURI_INTERNALS__) or on the desktop platform
// the plugin is never invoked (the plugin is mobile-only: its Rust crate is
// `#![cfg(mobile)]` and is not even registered on desktop), and the scan
// dispatch through the official plugin guest API on Tauri mobile.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanCancelledError, canScan, scanQrCode } from "./scanner";
import { refreshPlatform } from "../platform/index.js";

const { scanMock } = vi.hoisted(() => ({ scanMock: vi.fn() }));
vi.mock("@tauri-apps/plugin-barcode-scanner", () => ({
  scan: scanMock,
  Format: { QRCode: "QR_CODE" },
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

describe("canScan", () => {
  it("is false outside Tauri", () => {
    withoutTauri();
    withMobilePlatform();
    expect(canScan()).toBe(false);
  });

  it("is false on the desktop platform", () => {
    withTauri();
    withDesktopPlatform();
    expect(canScan()).toBe(false);
  });

  it("is true on Tauri mobile", () => {
    withTauri();
    withMobilePlatform();
    expect(canScan()).toBe(true);
  });
});

describe("scanQrCode", () => {
  it("does not invoke the plugin outside Tauri", async () => {
    withoutTauri();
    withMobilePlatform();
    await expect(scanQrCode()).rejects.toThrow("mobile app");
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("does not invoke the plugin on the desktop platform", async () => {
    withTauri();
    withDesktopPlatform();
    await expect(scanQrCode()).rejects.toThrow("mobile app");
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("scans QR codes on Tauri mobile and resolves the decoded text", async () => {
    withTauri();
    withMobilePlatform();
    scanMock.mockResolvedValue({
      content: "opencode://connect?url=http://host:14096&name=Home",
      format: "QR_CODE",
      bounds: null,
    });
    await expect(scanQrCode()).resolves.toBe("opencode://connect?url=http://host:14096&name=Home");
    expect(scanMock).toHaveBeenCalledWith({ formats: ["QR_CODE"] });
  });

  it("propagates scan failures (camera denied, cancelled)", async () => {
    withTauri();
    withMobilePlatform();
    scanMock.mockRejectedValue(new Error("camera permission denied"));
    await expect(scanQrCode()).rejects.toThrow("camera permission denied");
  });

  it('maps a cancelled scan (plugin rejects with "cancelled") to ScanCancelledError', async () => {
    withTauri();
    withMobilePlatform();
    scanMock.mockRejectedValue("cancelled");
    await expect(scanQrCode()).rejects.toBeInstanceOf(ScanCancelledError);
  });

  it("maps an Error-wrapped cancelled scan the same way", async () => {
    withTauri();
    withMobilePlatform();
    scanMock.mockRejectedValue(new Error("cancelled"));
    await expect(scanQrCode()).rejects.toBeInstanceOf(ScanCancelledError);
  });
});
