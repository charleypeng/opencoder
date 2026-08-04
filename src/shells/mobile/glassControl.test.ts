// L1 tests for the glass bar visibility control (TASK-M7-04): the web
// layer gates the native UITabBar — shown while the workspace is mounted,
// hidden on the servers home — via the bridge's setHidden message; both
// helpers are no-ops without the bridge.

import { afterEach, describe, expect, it, vi } from "vitest";
import { setGlassBarHidden, setGlassBarShown } from "./glassControl.js";

function stubBridge(postMessage = vi.fn()): typeof postMessage {
  Object.defineProperty(window, "webkit", {
    value: { messageHandlers: { glassBridge: { postMessage } } },
    configurable: true,
  });
  return postMessage;
}

afterEach(() => {
  delete window.webkit;
});

describe("glass bar visibility control", () => {
  it("setGlassBarShown posts setHidden(false) when the bridge is present", () => {
    const postMessage = stubBridge();
    setGlassBarShown();
    expect(postMessage).toHaveBeenCalledWith({ type: "setHidden", hidden: false });
  });

  it("setGlassBarHidden posts setHidden(true) when the bridge is present", () => {
    const postMessage = stubBridge();
    setGlassBarHidden();
    expect(postMessage).toHaveBeenCalledWith({ type: "setHidden", hidden: true });
  });

  it("both helpers are no-ops without the bridge", () => {
    expect(() => {
      setGlassBarShown();
      setGlassBarHidden();
    }).not.toThrow();
  });
});
