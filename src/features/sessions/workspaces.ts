// Per-server explicit workspace list (workspace layout redesign): directories
// the user added through the "Add workspace" flow. The tree normally derives
// workspaces from sessions + projects, but a picked directory with NO sessions
// and NO project record would vanish on restart — this persisted list keeps
// every added workspace visible. Removals drop the entry (and the tree's
// hidden set) so a removed workspace stays gone.

const KEY_PREFIX = "oc-workspaces:";

/**
 * Dispatched on every workspace-list write so reactive consumers
 * (WorkspaceTree) can re-read localStorage without polling. Same-window
 * dispatch is synchronous and does NOT fire for cross-tab changes (the
 * storage event does that, but it never fires in the writing window).
 */
export const WORKSPACE_STORAGE_EVENT = "oc-workspace-storage";

function notifyWorkspaceStorageChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(WORKSPACE_STORAGE_EVENT));
  } catch {
    // window may be unavailable (SSR/test without DOM): safe to skip.
  }
}

/** Reads a server's explicit workspace directories (oldest first). */
export function readWorkspaces(serverId: string): string[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + serverId);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    // Unreadable or blocked storage: an empty list (the tree still shows
    // the session/project-derived workspaces).
    return [];
  }
}

/** Adds a workspace directory (deduped, appended last). */
export function addWorkspace(serverId: string, directory: string): void {
  try {
    const next = readWorkspaces(serverId).filter((dir) => dir !== directory);
    next.push(directory);
    localStorage.setItem(KEY_PREFIX + serverId, JSON.stringify(next));
    notifyWorkspaceStorageChange();
  } catch {
    // Storage unavailable (private mode): the workspace just isn't persisted.
  }
}

/** Removes a workspace directory from the persisted list. */
export function removeWorkspace(serverId: string, directory: string): void {
  try {
    localStorage.setItem(
      KEY_PREFIX + serverId,
      JSON.stringify(readWorkspaces(serverId).filter((dir) => dir !== directory)),
    );
    notifyWorkspaceStorageChange();
  } catch {
    // Storage unavailable: nothing to persist anyway.
  }
}

/** Clears ALL persisted workspaces for a server (called on server removal). */
export function clearWorkspaces(serverId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + serverId);
    notifyWorkspaceStorageChange();
  } catch {
    // Storage unavailable: nothing to clear anyway.
  }
}
