// Per-server recent project memory (TASK-M2-03): a capped list of directory
// paths in localStorage, most recently switched first. Purely additive UI
// memory — the active directory itself lives in the project store.

const KEY_PREFIX = "oc-recent-projects:";
const RECENT_CAP = 5;

/** Reads the recent directory list for a server (never throws). */
export function readRecentProjects(serverId: string): string[] {
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

/** Pushes a directory to the front, dedupes and caps the list. */
export function pushRecentProject(serverId: string, directory: string): string[] {
  const next = [
    directory,
    ...readRecentProjects(serverId).filter((dir) => dir !== directory),
  ].slice(0, RECENT_CAP);
  try {
    localStorage.setItem(KEY_PREFIX + serverId, JSON.stringify(next));
  } catch {
    // Storage unavailable (e.g. private mode): the in-memory list still works.
  }
  return next;
}
