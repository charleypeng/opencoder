// Android share receive (TASK-M7-10): a facade over the documented
// `share-received` window event — the native delivery is pending the
// gen/android scaffolding (a MainActivity onNewIntent override reads
// ACTION_SEND text and dispatches `new CustomEvent("share-received",
// { detail: { text } })` into the webview; see docs/tasks/M7.md appendix
// for the Kotlin snippet to apply once the Gradle project exists). The
// web side only implements the contract: a pure payload resolver plus a
// window listener that hands the trimmed text to the caller (MobileShell
// → prefillComposer). No-op outside Tauri + Android (haptics discipline).

import { platform } from "../platform/index.js";

/** The documented event name the native bridge dispatches. */
export const SHARE_RECEIVED_EVENT = "share-received";

/** Pure payload validation: the event detail is `{ text }` and the text
 *  must be a non-blank string (trimmed). Anything else is rejected. */
export function resolveSharePayload(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null) return null;
  const text = (detail as { text?: unknown }).text;
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** Whether the share listener can run: inside Tauri AND on Android
 *  (iOS share extensions are a separate target, out of scope). */
export function isShareReceiveActive(): boolean {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) return false;
  return platform.kind === "mobile" && platform.os === "android";
}

export interface ShareReceiveController {
  dispose: () => void;
}

export function startShareReceive(options: {
  onShareText: (text: string) => void;
}): ShareReceiveController {
  let disposed = false;
  const onEvent = (event: Event): void => {
    if (disposed) return;
    const text = resolveSharePayload((event as CustomEvent<unknown>).detail);
    if (text === null) return;
    options.onShareText(text);
  };
  if (isShareReceiveActive()) {
    window.addEventListener(SHARE_RECEIVED_EVENT, onEvent);
  }
  return {
    dispose: () => {
      disposed = true;
      window.removeEventListener(SHARE_RECEIVED_EVENT, onEvent);
    },
  };
}
