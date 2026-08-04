// L1 tests for platform detection (TASK-M7-03): UA/WebView/viewport
// combinations resolve to the right Platform kind and OS (docs/architecture.md
// §3). Most cases pass DetectInput overrides; the refreshPlatform cases
// stub the live window and re-resolve the exported `platform`.

import { afterEach, describe, expect, it } from "vitest";
import { detect, platform, refreshPlatform } from "./index.js";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)";

const ORIGINAL_UA = window.navigator.userAgent;

afterEach(() => {
  // Restore the jsdom window (refreshPlatform re-resolves) so later suites
  // see the default desktop environment.
  Object.defineProperty(window.navigator, "userAgent", {
    value: ORIGINAL_UA,
    configurable: true,
  });
  delete window.webkit;
  delete (window as unknown as Record<string, unknown>).ontouchstart;
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  refreshPlatform();
});

describe("platform detection", () => {
  it("resolves desktop UAs to their OS", () => {
    expect(detect({ userAgent: MAC_UA })).toEqual({ kind: "desktop", os: "macos" });
    expect(detect({ userAgent: WIN_UA })).toEqual({ kind: "desktop", os: "windows" });
    expect(detect({ userAgent: LINUX_UA })).toEqual({ kind: "desktop", os: "linux" });
  });

  it("resolves mobile UAs to mobile platforms", () => {
    expect(detect({ userAgent: IPHONE_UA })).toEqual({ kind: "mobile", os: "ios" });
    expect(detect({ userAgent: IPHONE_UA.replace("iPhone", "iPad") })).toEqual({
      kind: "mobile",
      os: "ios",
    });
    expect(detect({ userAgent: ANDROID_UA })).toEqual({ kind: "mobile", os: "android" });
  });

  it("prefers the Tauri OS plugin report over the UA", () => {
    expect(detect({ userAgent: LINUX_UA, tauriOs: "ios" })).toEqual({ kind: "mobile", os: "ios" });
    expect(detect({ userAgent: MAC_UA, tauriOs: "android" })).toEqual({
      kind: "mobile",
      os: "android",
    });
  });

  it("detects iOS from webkit + touch + a phone-form viewport (iPadOS desktop UA)", () => {
    expect(
      detect({ userAgent: MAC_UA, hasWebkit: true, hasTouch: true, viewportWidth: 900 }),
    ).toEqual({ kind: "mobile", os: "ios" });
  });

  it("does NOT classify webkit + touch on a wide viewport as mobile", () => {
    expect(
      detect({ userAgent: MAC_UA, hasWebkit: true, hasTouch: true, viewportWidth: 1600 }),
    ).toEqual({ kind: "desktop", os: "macos" });
  });

  it("does NOT classify a touch-less WKWebView as mobile (Tauri macOS)", () => {
    expect(
      detect({ userAgent: MAC_UA, hasWebkit: true, hasTouch: false, viewportWidth: 1200 }),
    ).toEqual({ kind: "desktop", os: "macos" });
  });

  it("falls back to mobile for an unknown touch-capable narrow viewport", () => {
    expect(detect({ userAgent: "", hasTouch: true, viewportWidth: 390, hasWebkit: false })).toEqual(
      { kind: "mobile", os: "android" },
    );
  });

  it("falls back to desktop linux for an unknown non-touch environment", () => {
    expect(
      detect({ userAgent: "", hasTouch: false, viewportWidth: 1024, hasWebkit: false }),
    ).toEqual({
      kind: "desktop",
      os: "linux",
    });
  });

  it("refreshPlatform re-resolves the exported platform from the live window", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: IPHONE_UA,
      configurable: true,
    });
    refreshPlatform();
    expect(platform).toEqual({ kind: "mobile", os: "ios" });

    Object.defineProperty(window.navigator, "userAgent", {
      value: ORIGINAL_UA,
      configurable: true,
    });
    refreshPlatform();
    expect(platform).toEqual({ kind: "desktop", os: "linux" });
  });

  it("detects iOS via the live webkit signal without a mobile UA", () => {
    Object.defineProperty(window, "webkit", { value: {}, configurable: true });
    Object.defineProperty(window, "ontouchstart", { value: null, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
    expect(refreshPlatform()).toEqual({ kind: "mobile", os: "ios" });
  });
});
