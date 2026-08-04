// Haptics facade (TASK-M7-07): four semantic patterns mapped onto the
// official tauri-plugin-haptics guest API (impact light for a send,
// notification success/warning/error for completion, permissions and
// errors). The plugin's Rust side is a no-op on desktop, so the facade
// refuses to dispatch there too — no IPC roundtrip is spent outside the
// mobile form factor. Outside Tauri (web preview / tests) it never fires.
// All call sites use the fire-and-forget `haptic(kind)`; failures are
// swallowed (a missing haptics engine must never break the flow).

import { impactFeedback, notificationFeedback } from "@tauri-apps/plugin-haptics";
import { platform } from "../platform/index.js";

export type HapticKind = "send" | "complete" | "permission" | "error";

/** Discriminated plan: the plugin guest API entry point and its pattern
 *  argument (the union narrows `arg` per `command`, so the plugin calls
 *  type-check without casts). */
export type HapticPlan =
  | { command: "impact"; arg: "light" }
  | { command: "notification"; arg: "success" | "warning" | "error" };

/** Pure kind -> plugin pattern mapping (unit-tested; the single source of
 *  truth for what each event feels like). */
export function hapticPlan(kind: HapticKind): HapticPlan {
  switch (kind) {
    case "send":
      return { command: "impact", arg: "light" };
    case "complete":
      return { command: "notification", arg: "success" };
    case "permission":
      return { command: "notification", arg: "warning" };
    case "error":
      return { command: "notification", arg: "error" };
  }
}

/** Whether native haptics can fire: inside Tauri AND on a mobile platform
 *  (the Rust side is a no-op on desktop, so dispatch is skipped there). */
export function isHapticsActive(): boolean {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) return false;
  return platform.kind === "mobile";
}

/** Fires the haptic pattern for the given event; a no-op outside
 *  Tauri/mobile. Fire-and-forget: rejections are swallowed. */
export async function haptic(kind: HapticKind): Promise<void> {
  if (!isHapticsActive()) return;
  const plan = hapticPlan(kind);
  const feedback =
    plan.command === "impact" ? impactFeedback(plan.arg) : notificationFeedback(plan.arg);
  try {
    await feedback;
  } catch {
    // A missing/failed haptics engine must never break the flow.
  }
}
