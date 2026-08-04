// Android system back handler (TASK-M7-10). Research finding (verified
// against tauri 2.11.5 sources, mobile/android/.../app/tauri/AppPlugin.kt):
// the Android back button is handled by the BUILT-IN core "app" plugin —
// no third-party plugin (there is no tauri-plugin-back-button in the
// plugins-workspace) and no custom Kotlin override are needed. While a JS
// listener for the `back-button` event is registered (via
// @tauri-apps/api/event listen), every back press triggers that event
// with a `{ canGoBack }` payload instead of the system default; WITHOUT a
// registered listener the WebView history back / system default (finish
// the activity) runs natively.
//
// The `canGoBack` flag reflects WebView history, which a SPA does not
// use, so the decision is resolved from OUR navigation state instead:
//  1. a dismissible bottom sheet is open  -> close the sheet (priority)
//  2. the active tab's stack is deeper    -> pop
//  3. anything else (root, or a PINNED sheet — permission/question must
//     be answered, not skipped, TASK-M7-05) -> NOTHING to handle.
// In case 3 the facade UNREGISTERS the listener, so Android's native
// back behavior (background the app) resumes automatically — nothing is
// swallowed and no exit command is needed (`plugin:app|exit` is not
// exposed through the core:app ACL, verified against the Rust "app"
// plugin invoke handler).
//
// The listener registration follows the context reactively (Solid
// createRoot): navigation pushes/pops and sheet open/close re-evaluate
// it, so the native event only exists while the web side can actually
// handle a back press.

import { createEffect, createRoot } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { platform } from "../platform/index.js";

/** The core Android back event name (built-in app plugin, see above). */
export const ANDROID_BACK_EVENT = "back-button";

export type BackDecision = "closeSheet" | "pop" | "none";

export interface BackContext {
  /** The topmost open bottom sheet (null when none). */
  sheet: { dismissible: boolean } | null;
  /** The active tab's route stack depth (1 = its root page). */
  stackDepth: number;
}

export interface BackHandlers {
  /** Closes the open (dismissible) sheet. */
  closeSheet: () => void;
  /** Pops the active tab's route stack. */
  pop: () => void;
}

/** Pure back-press decision (unit-tested; the single source of truth). */
export function resolveBack(context: BackContext): BackDecision {
  const sheet = context.sheet;
  if (sheet !== null) {
    // Pinned sheets (permission/question) are never closed by back — a
    // request must be answered, not skipped.
    return sheet.dismissible ? "closeSheet" : "none";
  }
  if (context.stackDepth > 1) return "pop";
  return "none";
}

/** Whether the native back listener can be used: inside Tauri AND on
 *  Android (the event only exists there). */
export function isAndroidBackActive(): boolean {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) return false;
  return platform.kind === "mobile" && platform.os === "android";
}

export interface AndroidBackController {
  /** Whether the native `back-button` listener is currently registered. */
  listening(): boolean;
  /** Unregisters the listener and stops the controller. */
  dispose(): void;
}

export function startAndroidBack(options: {
  getContext: () => BackContext;
  handlers: BackHandlers;
}): AndroidBackController {
  let unlistenFn: UnlistenFn | null = null;
  let listenInFlight: Promise<void> | null = null;
  let disposed = false;
  let disposeRoot: (() => void) | null = null;

  /** Dispatches one native back press through the pure resolver. */
  function handleBackPress(): void {
    const decision = resolveBack(options.getContext());
    if (decision === "closeSheet") options.handlers.closeSheet();
    else if (decision === "pop") options.handlers.pop();
  }

  async function startListening(): Promise<void> {
    if (unlistenFn !== null || listenInFlight !== null) return;
    listenInFlight = listen<{ canGoBack: boolean }>(ANDROID_BACK_EVENT, handleBackPress)
      .then((fn) => {
        unlistenFn = fn;
      })
      .catch(() => {
        // Registration failed (e.g. no Tauri event bridge): retried on
        // the next context change; back falls back to the system default.
      })
      .finally(() => {
        listenInFlight = null;
      });
    await listenInFlight;
  }

  async function stopListening(): Promise<void> {
    if (listenInFlight !== null) await listenInFlight;
    if (unlistenFn !== null) {
      unlistenFn();
      unlistenFn = null;
    }
  }

  /** Re-evaluates whether the native listener should exist. */
  function sync(): void {
    if (disposed) return;
    if (!isAndroidBackActive()) {
      void stopListening();
      return;
    }
    const want = resolveBack(options.getContext()) !== "none";
    if (want) void startListening();
    else void stopListening();
  }

  // Reactive loop: re-reads the context on every navigation / sheet
  // change (the reads inside resolveBack are tracked by Solid).
  disposeRoot = createRoot((dispose) => {
    createEffect(() => {
      sync();
    });
    return dispose;
  });

  return {
    listening: () => unlistenFn !== null,
    dispose: () => {
      disposed = true;
      disposeRoot?.();
      disposeRoot = null;
      void stopListening();
    },
  };
}
