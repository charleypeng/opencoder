// Android system back handler (TASK-M7-10). Research finding (verified
// against tauri 2.11.5 sources, mobile/android/.../app/tauri/AppPlugin.kt):
// the Android back button is handled by the BUILT-IN core "app" plugin —
// no third-party plugin (there is no tauri-plugin-back-button in the
// plugins-workspace) and no custom Kotlin override are needed. The Kotlin
// AppPlugin gates native back handling on ITS OWN listener registry,
// populated ONLY via the `plugin:app|register_listener` command — i.e. the
// JS API `onBackButtonPress` from `@tauri-apps/api/app` (a plain
// `listen("back-button")` event subscription is Rust-side and never
// reaches Kotlin). While the listener is registered every back press is
// delivered with a `{ canGoBack }` payload instead of the system default;
// WITHOUT a registered listener the native default (background the
// activity) runs.
//
// The `canGoBack` flag reflects WebView history, which a SPA does not
// use, so the decision is resolved from OUR navigation state instead:
//  1. a dismissible bottom sheet is open  -> close the sheet (priority)
//  2. the settings dialog is open         -> close it
//  3. the active tab's stack is deeper    -> pop
//  4. anything else (root, or a PINNED sheet — permission/question must
//     be answered, not skipped, TASK-M7-05) -> NOTHING to handle.
// In case 4 the facade UNREGISTERS the listener, so Android's native
// back behavior (background the app) resumes automatically — nothing is
// swallowed and no exit command is needed (`plugin:app|exit` is not
// exposed through the core:app ACL, verified against the Rust "app"
// plugin invoke handler).
//
// The listener registration follows the context reactively (Solid
// createRoot): navigation pushes/pops and sheet open/close re-evaluate
// it, so the native listener only exists while the web side can actually
// handle a back press.

import { createEffect, createRoot } from "solid-js";
import { onBackButtonPress } from "@tauri-apps/api/app";
import type { PluginListener } from "@tauri-apps/api/core";
import { platform } from "../platform/index.js";

export type BackDecision = "closeSheet" | "closeSettings" | "pop" | "none";

export interface BackContext {
  /** The topmost open bottom sheet (null when none). */
  sheet: { dismissible: boolean } | null;
  /** Whether the settings dialog is open (TASK-UI-01). */
  settingsOpen?: boolean;
  /** The active tab's route stack depth (1 = its root page). */
  stackDepth: number;
}

export interface BackHandlers {
  /** Closes the open (dismissible) sheet. */
  closeSheet: () => void;
  /** Closes the settings dialog (TASK-UI-01). */
  closeSettings?: () => void;
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
  if (context.settingsOpen === true) return "closeSettings";
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
  /** Whether the native back listener is currently registered. */
  listening(): boolean;
  /** Unregisters the listener and stops the controller. */
  dispose(): void;
}

export function startAndroidBack(options: {
  getContext: () => BackContext;
  handlers: BackHandlers;
}): AndroidBackController {
  let listener: PluginListener | null = null;
  let listenInFlight: Promise<void> | null = null;
  let disposed = false;
  let disposeRoot: (() => void) | null = null;

  /** Dispatches one native back press through the pure resolver. */
  function handleBackPress(): void {
    const decision = resolveBack(options.getContext());
    if (decision === "closeSheet") options.handlers.closeSheet();
    else if (decision === "closeSettings") options.handlers.closeSettings?.();
    else if (decision === "pop") options.handlers.pop();
  }

  async function startListening(): Promise<void> {
    if (listener !== null || listenInFlight !== null) return;
    listenInFlight = onBackButtonPress(handleBackPress)
      .then((l) => {
        listener = l;
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
    if (listener !== null) {
      const l = listener;
      listener = null;
      await l.unregister();
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
    listening: () => listener !== null,
    dispose: () => {
      disposed = true;
      disposeRoot?.();
      disposeRoot = null;
      void stopListening();
    },
  };
}
