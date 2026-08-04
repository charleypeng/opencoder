// Desktop tray & global summon facade (TASK-M8-05): thin typed wrappers
// over the Rust commands (set_close_to_tray / get_close_to_tray /
// set_global_shortcut / get_global_shortcut / tray_set_badge) and the
// tray events (tray-new-session, global-summon). Mirrors the events.ts
// outside-Tauri no-op guard so the desktop-only surface never touches the
// IPC layer in web or mobile builds.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Default summon accelerator registered by Rust at startup. */
export const DEFAULT_SUMMON_SHORTCUT = "Alt+Space";

function inTauri(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

/** Enables or disables close-to-tray (the window hides instead of
 *  quitting); no-op outside Tauri. */
export function setCloseToTray(enabled: boolean): Promise<void> {
  if (!inTauri()) return Promise.resolve();
  return invoke("set_close_to_tray", { enabled });
}

/** Current close-to-tray flag; false outside Tauri. */
export function getCloseToTray(): Promise<boolean> {
  if (!inTauri()) return Promise.resolve(false);
  return invoke("get_close_to_tray");
}

/** Replaces the global summon accelerator (e.g. "Alt+Space"); resolves
 *  with the applied accelerator, rejects with the validation/OS error.
 *  No-op (resolves the input) outside Tauri. */
export function setGlobalShortcut(accelerator: string): Promise<string> {
  if (!inTauri()) return Promise.resolve(accelerator);
  return invoke("set_global_shortcut", { accelerator });
}

/** The accelerator currently registered for the global summon; the
 *  default outside Tauri. */
export function getGlobalShortcut(): Promise<string> {
  if (!inTauri()) return Promise.resolve(DEFAULT_SUMMON_SHORTCUT);
  return invoke("get_global_shortcut");
}

/** Pushes the pending-permission count onto the tray icon (macOS badge /
 *  Linux title text; Windows ignores titles). Non-positive counts are
 *  ignored; no-op outside Tauri. */
export function setTrayBadge(count: number): Promise<void> {
  if (!inTauri() || !Number.isInteger(count) || count <= 0) return Promise.resolve();
  return invoke("tray_set_badge", { count });
}

/** Subscribes to the tray menu's "New session" clicks; returns an
 *  unlisten function. Outside Tauri it is a no-op. */
export function subscribeToTrayNewSession(onNewSession: () => void): () => void {
  if (!inTauri()) return () => {};
  const unlisten = listen("tray-new-session", () => onNewSession());
  return () => {
    void unlisten.then((unlisten) => unlisten());
  };
}

/** Subscribes to the global summon shortcut presses (the window is shown
 *  and focused by Rust; the frontend may react, e.g. flash). Returns an
 *  unlisten function. Outside Tauri it is a no-op. */
export function subscribeToGlobalSummon(onSummon: () => void): () => void {
  if (!inTauri()) return () => {};
  const unlisten = listen("global-summon", () => onSummon());
  return () => {
    void unlisten.then((unlisten) => unlisten());
  };
}
