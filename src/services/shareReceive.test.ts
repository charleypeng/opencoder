// L1 tests for the Android share receive (TASK-M7-10): the pure payload
// resolver (the documented `share-received` event carries `{ text }`), the
// window listener that hands the trimmed text to the caller, and the
// Tauri+Android guard (haptics discipline: no-op elsewhere). Native
// delivery is pending gen/android scaffolding (see docs/tasks/M7.md).

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isShareReceiveActive,
  resolveSharePayload,
  SHARE_RECEIVED_EVENT,
  startShareReceive,
} from "./shareReceive";
import { refreshPlatform } from "../platform/index.js";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const ORIGINAL_UA = window.navigator.userAgent;

function withTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

function withoutTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, configurable: true });
}

function withAndroidPlatform(): void {
  Object.defineProperty(window.navigator, "userAgent", { value: ANDROID_UA, configurable: true });
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

function dispatchShare(detail: unknown): void {
  window.dispatchEvent(new CustomEvent(SHARE_RECEIVED_EVENT, { detail }));
}

describe("resolveSharePayload", () => {
  it("accepts a non-blank { text } payload and trims it", () => {
    expect(resolveSharePayload({ text: "  hello  " })).toBe("hello");
    expect(resolveSharePayload({ text: "hello" })).toBe("hello");
  });

  it("rejects blank, missing or malformed payloads", () => {
    expect(resolveSharePayload({ text: "   " })).toBeNull();
    expect(resolveSharePayload({ text: "" })).toBeNull();
    expect(resolveSharePayload({ text: 42 })).toBeNull();
    expect(resolveSharePayload({})).toBeNull();
    expect(resolveSharePayload(null)).toBeNull();
    expect(resolveSharePayload("hello")).toBeNull();
    expect(resolveSharePayload(undefined)).toBeNull();
  });
});

describe("isShareReceiveActive", () => {
  it("is inactive outside Tauri", () => {
    withoutTauri();
    withAndroidPlatform();
    expect(isShareReceiveActive()).toBe(false);
  });

  it("is inactive on the desktop platform", () => {
    withTauri();
    withDesktopPlatform();
    expect(isShareReceiveActive()).toBe(false);
  });

  it("is active on Tauri Android", () => {
    withTauri();
    withAndroidPlatform();
    expect(isShareReceiveActive()).toBe(true);
  });
});

describe("startShareReceive", () => {
  it("forwards the shared text to the caller", () => {
    withTauri();
    withAndroidPlatform();
    const onShareText = vi.fn();
    const controller = startShareReceive({ onShareText });

    dispatchShare({ text: "  shared prompt  " });
    expect(onShareText).toHaveBeenCalledWith("shared prompt");
    expect(onShareText).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("ignores blank or malformed shares", () => {
    withTauri();
    withAndroidPlatform();
    const onShareText = vi.fn();
    const controller = startShareReceive({ onShareText });

    dispatchShare({ text: "   " });
    dispatchShare({});
    dispatchShare(null);
    expect(onShareText).not.toHaveBeenCalled();

    controller.dispose();
  });

  it("stops forwarding after dispose", () => {
    withTauri();
    withAndroidPlatform();
    const onShareText = vi.fn();
    const controller = startShareReceive({ onShareText });

    controller.dispose();
    dispatchShare({ text: "late" });
    expect(onShareText).not.toHaveBeenCalled();
  });

  it("never listens outside Tauri or off Android", () => {
    const onShareText = vi.fn();
    withDesktopPlatform();
    withTauri();
    startShareReceive({ onShareText });
    withoutTauri();
    withAndroidPlatform();
    startShareReceive({ onShareText });

    dispatchShare({ text: "ignored" });
    expect(onShareText).not.toHaveBeenCalled();
  });
});
