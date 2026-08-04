// Per-server recent file memory (TASK-M4-04): a capped list of opened file
// paths in localStorage, most recently opened first. Purely additive UI
// memory — the opened tabs themselves live in the viewer store.

const KEY_PREFIX = "oc-recent-files:";
const RECENT_CAP = 20;

/** Reads the recent file list for a server (never throws). */
export function readRecentFiles(serverId: string): string[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + serverId);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    // Unreadable or blocked storage: fall back to an empty list.
    return [];
  }
}

/** Pushes a path to the front, dedupes and caps the list. */
export function pushRecentFile(serverId: string, path: string): string[] {
  const next = [path, ...readRecentFiles(serverId).filter((entry) => entry !== path)].slice(
    0,
    RECENT_CAP,
  );
  try {
    localStorage.setItem(KEY_PREFIX + serverId, JSON.stringify(next));
  } catch {
    // Storage unavailable (e.g. private mode): the in-memory list still works.
  }
  return next;
}
