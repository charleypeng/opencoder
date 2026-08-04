// Desktop preference persistence (TASK-M8-05): the close-to-tray toggle
// and the custom summon accelerator live in Rust at runtime; localStorage
// (`oc-desktop`) keeps them across restarts and DesktopShell re-applies
// them at mount via applyDesktopPrefs (the default accelerator is already
// registered by Rust at startup, so only custom values are pushed).
// TASK-M8-07: the pet-enabled switch (default on; DesktopShell mounts the
// pet window when it is not explicitly off) shares the same store.

import { setCloseToTray, setGlobalShortcut, DEFAULT_SUMMON_SHORTCUT } from "../../services/tray.js";
import { hidePet, showPet } from "../../services/pet.js";

export interface DesktopPrefs {
  /** Whether closing the main window hides it to the tray instead. */
  closeToTray?: boolean;
  /** Custom summon accelerator (e.g. "Ctrl+Shift+O"). */
  globalShortcut?: string;
  /** Whether the pet companion window is shown (default: on). */
  petEnabled?: boolean;
}

const KEY = "oc-desktop";

/** Reads the persisted desktop prefs; malformed payloads yield {} (the
 *  runtime defaults stay in effect). */
export function loadDesktopPrefs(): DesktopPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as Partial<DesktopPrefs>;
    if (parsed === null || typeof parsed !== "object") return {};
    const prefs: DesktopPrefs = {};
    if (typeof parsed.closeToTray === "boolean") prefs.closeToTray = parsed.closeToTray;
    if (typeof parsed.petEnabled === "boolean") prefs.petEnabled = parsed.petEnabled;
    if (typeof parsed.globalShortcut === "string" && parsed.globalShortcut.trim() !== "") {
      prefs.globalShortcut = parsed.globalShortcut;
    }
    return prefs;
  } catch {
    return {};
  }
}

/** Persists the desktop prefs; storage failures (private mode) are
 *  swallowed — the current session keeps working. */
export function saveDesktopPrefs(prefs: DesktopPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: nothing to persist, nothing to report.
  }
}

/** Re-applies the persisted prefs to the Rust runtime (called by
 *  DesktopShell on mount). The default accelerator is skipped because
 *  Rust already registered it at startup. */
export async function applyDesktopPrefs(): Promise<void> {
  const prefs = loadDesktopPrefs();
  if (prefs.closeToTray !== undefined) {
    await setCloseToTray(prefs.closeToTray);
  }
  if (prefs.globalShortcut !== undefined && prefs.globalShortcut !== DEFAULT_SUMMON_SHORTCUT) {
    await setGlobalShortcut(prefs.globalShortcut);
  }
}

/** Whether the pet companion should be shown at shell mount: on by
 *  default, off only when the pref explicitly says so. */
export function petEnabled(): boolean {
  return loadDesktopPrefs().petEnabled !== false;
}

/** Turns the pet companion on or off: applies the window action
 *  immediately and persists the pref so the next launch matches. */
export async function setPetEnabled(enabled: boolean): Promise<void> {
  saveDesktopPrefs({ ...loadDesktopPrefs(), petEnabled: enabled });
  if (enabled) {
    await showPet();
  } else {
    await hidePet();
  }
}
