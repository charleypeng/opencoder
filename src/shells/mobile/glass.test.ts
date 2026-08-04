// L1 tests for the glass bridge helpers (TASK-M7-03): bridge detection,
// web -> native posting, and native -> web handler install with cleanup.

import { afterEach, describe, expect, it, vi } from "vitest";
import { hasGlassBridge, installGlassTabHandler, postGlassMessage } from "./glass.js";

function stubBridge(messageHandlers?: {
  glassBridge?: { postMessage: (m: unknown) => void };
}): void {
  Object.defineProperty(window, "webkit", {
    value: messageHandlers === undefined ? {} : { messageHandlers },
    configurable: true,
  });
}

afterEach(() => {
  delete window.webkit;
  delete window.__glassTabSelected;
  delete window.__glassNativePing;
});

describe("glass bridge helpers", () => {
  it("hasGlassBridge is false without webkit or the handler", () => {
    expect(hasGlassBridge()).toBe(false);
    stubBridge();
    expect(hasGlassBridge()).toBe(false);
  });

  it("hasGlassBridge is true when the glassBridge handler exists", () => {
    stubBridge({ glassBridge: { postMessage: vi.fn() } });
    expect(hasGlassBridge()).toBe(true);
  });

  it("postGlassMessage posts to the bridge when present", () => {
    const postMessage = vi.fn();
    stubBridge({ glassBridge: { postMessage } });
    postGlassMessage({ type: "setActive", index: 1 });
    expect(postMessage).toHaveBeenCalledWith({ type: "setActive", index: 1 });
  });

  it("postGlassMessage is a no-op without the bridge", () => {
    expect(() => postGlassMessage({ type: "ping" })).not.toThrow();
  });

  it("installGlassTabHandler registers the handler and cleanup restores the previous one", () => {
    const previous = vi.fn();
    const handler = vi.fn();
    window.__glassTabSelected = previous;
    const cleanup = installGlassTabHandler(handler);

    window.__glassTabSelected?.(2);
    expect(handler).toHaveBeenCalledWith(2);
    expect(previous).not.toHaveBeenCalled();

    cleanup();
    window.__glassTabSelected?.(3);
    expect(previous).toHaveBeenCalledWith(3);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("installGlassTabHandler with no previous handler cleans up to undefined", () => {
    const cleanup = installGlassTabHandler(vi.fn());
    expect(typeof window.__glassTabSelected).toBe("function");
    cleanup();
    expect(window.__glassTabSelected).toBeUndefined();
  });
});
