// Desktop preference persistence (TASK-M8-05): the close-to-tray toggle
// and the custom summon accelerator live in Rust at runtime; localStorage
// (`oc-desktop`) keeps them across restarts and DesktopShell re-applies
// them at mount via applyDesktopPrefs (the default accelerator is already
// registered by Rust at startup, so only custom values are pushed).

import { setCloseToTray, setGlobalShortcut, DEFAULT_SUMMON_SHORTCUT } from "../../services/tray.js";

export interface DesktopPrefs {
  /** Whether closing the main window hides it to the tray instead. */
  closeToTray?: boolean;
  /** Custom summon accelerator (e.g. "Ctrl+Shift+O"). */
  globalShortcut?: string;
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
