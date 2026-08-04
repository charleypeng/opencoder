// Notification preferences (TASK-M8-06): the do-not-disturb master
// switch plus per-server overrides, persisted to localStorage
// (`oc-notifications`). Absent fields mean ON (default), so a fresh
// install notifies everywhere and the settings UI only ever writes
// explicit values. Mirrors the desktopPrefs pattern (features/settings):
// plain functions, malformed payloads discarded, storage failures
// swallowed.

export interface NotificationPrefs {
  /** Master switch; absent = enabled. */
  enabled?: boolean;
  /** Per-server override keyed by server id; absent server = enabled. */
  perServer?: Record<string, boolean>;
}

const KEY = "oc-notifications";

/** Reads the persisted prefs; malformed payloads yield {} (defaults on). */
export function loadNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    if (parsed === null || typeof parsed !== "object") return {};
    const prefs: NotificationPrefs = {};
    if (typeof parsed.enabled === "boolean") prefs.enabled = parsed.enabled;
    if (parsed.perServer !== null && typeof parsed.perServer === "object") {
      const perServer: Record<string, boolean> = {};
      for (const [serverId, value] of Object.entries(parsed.perServer)) {
        if (typeof value === "boolean") perServer[serverId] = value;
      }
      prefs.perServer = perServer;
    }
    return prefs;
  } catch {
    return {};
  }
}

/** Persists the prefs; storage failures (private mode) are swallowed. */
export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: nothing to persist, nothing to report.
  }
}

/** The master switch; absent = enabled. */
export function notificationsEnabled(prefs: NotificationPrefs = loadNotificationPrefs()): boolean {
  return prefs.enabled !== false;
}

/** One server's own switch; absent = enabled. */
export function serverNotificationsEnabled(
  serverId: string,
  prefs: NotificationPrefs = loadNotificationPrefs(),
): boolean {
  return prefs.perServer?.[serverId] !== false;
}

/** Toggles the master switch and persists. */
export function setNotificationsEnabled(enabled: boolean): void {
  saveNotificationPrefs({ ...loadNotificationPrefs(), enabled });
}

/** Toggles one server's switch and persists. */
export function setServerNotificationsEnabled(serverId: string, enabled: boolean): void {
  const prefs = loadNotificationPrefs();
  saveNotificationPrefs({ ...prefs, perServer: { ...prefs.perServer, [serverId]: enabled } });
}
