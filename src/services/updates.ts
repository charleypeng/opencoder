// Application auto-update facade (TASK-M8-09): thin typed wrappers over the
// tauri-plugin-updater guest API (check / downloadAndInstall) and the
// relaunch primitive from tauri-plugin-process, behind the events.ts
// outside-Tauri no-op guard (web builds / L2 environments never touch the
// IPC layer). The updater endpoint points at the GitHub releases latest.json
// pattern (tauri.conf.json); until the M10-04 release pipeline publishes
// signed artifacts the check resolves null (no update) or fails, both of
// which the Updates settings section renders. The signing keypair was
// generated with `pnpm tauri signer generate` — the PUBLIC key sits in
// tauri.conf.json `plugins.updater.pubkey`, the PRIVATE key lives at
// ~/.tauri/opencoder.key and is NEVER committed (the release pipeline signs
// with it; it must be backed up before the first publish). The once-a-day
// startup auto-check timestamp lives in localStorage (`oc-updates`),
// following the desktopPrefs discipline: malformed payloads dropped, storage
// failures swallowed.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export type { Update };

/** Freshness window for the startup auto-check: at most one check per day. */
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const LAST_CHECK_KEY = "oc-updates";

/** Download progress snapshot reported by installAndRelaunch's callback. */
export interface UpdateProgress {
  /** Bytes downloaded so far (accumulated across Progress events). */
  downloaded: number;
  /** Total size in bytes when the server reported one (optional). */
  total?: number;
  /** downloaded / total, 0..1; undefined while the total is unknown. */
  fraction?: number;
}

function inTauri(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

/** The running app version; null outside Tauri (no IPC). */
export function getAppVersion(): Promise<string | null> {
  if (!inTauri()) return Promise.resolve(null);
  return getVersion();
}

/**
 * Checks for an application update; resolves the available update or null
 * when the app is up to date. Outside Tauri (and with an unreachable
 * endpoint) it resolves null; hard failures (e.g. an endpoint that answers
 * 500) reject so the settings section can surface them.
 */
export function checkForUpdates(): Promise<Update | null> {
  if (!inTauri()) return Promise.resolve(null);
  return check();
}

/**
 * Downloads and installs the given update, reporting progress through
 * `onProgress` (accumulated bytes + fraction), then relaunches the app.
 * The rejection propagates to the caller (the settings section keeps the
 * install state and shows the error inline).
 */
export async function installAndRelaunch(
  update: Update,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  if (!inTauri()) return;
  let downloaded = 0;
  let total: number | undefined;
  await update.downloadAndInstall((event) => {
    if (event.event === "Finished") return;
    if (event.event === "Started") {
      total = event.data.contentLength;
    } else {
      downloaded += event.data.chunkLength;
    }
    onProgress?.({ downloaded, total, fraction: total ? downloaded / total : undefined });
  });
  await relaunch();
}

/** The persisted last auto-check timestamp; undefined when never checked. */
export function loadLastCheck(): number | undefined {
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as { lastCheck?: unknown };
    return typeof parsed.lastCheck === "number" && Number.isFinite(parsed.lastCheck)
      ? parsed.lastCheck
      : undefined;
  } catch {
    return undefined;
  }
}

/** Persists a successful startup auto-check timestamp. */
export function recordLastCheck(now: number = Date.now()): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, JSON.stringify({ lastCheck: now }));
  } catch {
    // Storage unavailable: the next startup checks again.
  }
}

/**
 * Whether the startup auto-check should run now: true when no check was
 * ever recorded (or the stored timestamp is invalid) or the last one is
 * older than AUTO_CHECK_INTERVAL_MS. Pure for L1 tests.
 */
export function shouldAutoCheck(lastCheckMs: number | undefined, nowMs: number): boolean {
  if (typeof lastCheckMs !== "number" || !Number.isFinite(lastCheckMs)) return true;
  return nowMs - lastCheckMs >= AUTO_CHECK_INTERVAL_MS;
}
