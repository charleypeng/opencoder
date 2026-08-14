// Per-server default workspace memory (feat(default-workspace)): the
// directory a server should land in when entered for the first time — and
// every time afterwards, unless the user re-picks one. Purely client-side
// UI memory (localStorage), like the recent-projects list; the actual
// "enter directory" side effect is the project store's `setCurrent`.

const KEY_PREFIX = "oc-default-workspace:";

/** Reads a server's default workspace directory (null when unset). */
export function readDefaultWorkspace(serverId: string): string | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + serverId);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
  } catch {
    // Unreadable or blocked storage: behave as unset.
    return null;
  }
}

/** Sets (or clears with null) a server's default workspace directory. */
export function setDefaultWorkspace(serverId: string, directory: string | null): void {
  try {
    if (directory === null || directory === "") localStorage.removeItem(KEY_PREFIX + serverId);
    else localStorage.setItem(KEY_PREFIX + serverId, JSON.stringify(directory));
  } catch {
    // Storage unavailable (private mode): the choice just doesn't persist.
  }
}

/** True when the server has ANY working-directory history (a default
 *  workspace or recent directories) — used to decide whether first-entry
 *  should prompt for a default workspace without bothering existing users. */
export function hasWorkspaceHistory(serverId: string): boolean {
  if (readDefaultWorkspace(serverId) !== null) return true;
  try {
    const recent = localStorage.getItem(`oc-recent-projects:${serverId}`);
    if (recent === null) return false;
    const parsed: unknown = JSON.parse(recent);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

const PROMPTED_KEY_PREFIX = "oc-default-workspace-prompted:";

/** True when the first-entry onboarding was already shown for the server —
 *  a skipped prompt is remembered so it does not nag on every entry. */
export function wasDefaultWorkspacePrompted(serverId: string): boolean {
  try {
    return localStorage.getItem(PROMPTED_KEY_PREFIX + serverId) === "1";
  } catch {
    return false;
  }
}

/** Marks the onboarding as shown (called when the dialog opens). */
export function markDefaultWorkspacePrompted(serverId: string): void {
  try {
    localStorage.setItem(PROMPTED_KEY_PREFIX + serverId, "1");
  } catch {
    // Storage unavailable: the prompt may show again next entry.
  }
}
