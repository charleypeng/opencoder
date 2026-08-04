// Glass bridge helpers (TASK-M7-03): the web <-> native contract with the
// tauri-plugin-glass iOS plugin (M7-02 concluded: tier A — a native Liquid
// Glass UITabBar injected into the WKWebView context).
//
//   native -> web: window.__glassTabSelected(index)   (0-based tab index)
//   web -> native: window.webkit.messageHandlers.glassBridge.postMessage({
//                  type: "setActive", index } | { type: "ping" })
//
// Every helper reads window at call time, so tests can stub the bridge.

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        glassBridge?: { postMessage: (message: unknown) => void };
      };
    };
    __glassTabSelected?: (index: number) => void;
    __glassNativePing?: (message: string) => void;
  }
}

/** True when the native glass bridge is reachable (iOS WKWebView with the
 *  plugin loaded). */
export function hasGlassBridge(): boolean {
  return typeof window.webkit?.messageHandlers?.glassBridge === "object";
}

/** Sends a web -> native message over the glass bridge (no-op without it). */
export function postGlassMessage(message: unknown): void {
  window.webkit?.messageHandlers?.glassBridge?.postMessage(message);
}

/** Registers the native -> web tab-selected handler; the returned cleanup
 *  restores whatever handler was installed before. */
export function installGlassTabHandler(handler: (index: number) => void): () => void {
  const previous = window.__glassTabSelected;
  window.__glassTabSelected = handler;
  return () => {
    if (window.__glassTabSelected === handler) window.__glassTabSelected = previous;
  };
}
