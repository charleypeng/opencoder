// Remember memo (TASK-M5-01): session-scoped memory of "always allow"
// decisions, keyed by (server, permission + patterns). When a matching
// permission.asked arrives, the permission sheet auto-replies "always"
// without showing the card. The server persists `always` decisions in its
// own permission rules; this memo covers the window where a restarted or
// fresh server has lost them, so a remembered pattern is never asked twice
// in the session.

import type { PermissionRequest } from "../../services/permission.js";

const remembered = new Map<string, Set<string>>();

/**
 * Stable signature for one permission+patterns combination. Pattern order
 * is normalized (sorted) so `["git status", "ls"]` and `["ls", "git
 * status"]` match the same decision.
 */
export function permissionSignature(
  request: Pick<PermissionRequest, "permission" | "patterns">,
): string {
  const patterns = Array.isArray(request.patterns) ? request.patterns : [];
  return `${request.permission}\u0000${[...patterns].sort().join("\u0001")}`;
}

/** Records an "always allow" decision for the rest of the session. */
export function rememberPattern(
  serverId: string,
  request: Pick<PermissionRequest, "permission" | "patterns">,
): void {
  const signatures = remembered.get(serverId) ?? new Set<string>();
  signatures.add(permissionSignature(request));
  remembered.set(serverId, signatures);
}

/** True when an "always allow" decision was recorded for the same pattern. */
export function isPatternRemembered(
  serverId: string,
  request: Pick<PermissionRequest, "permission" | "patterns">,
): boolean {
  return remembered.get(serverId)?.has(permissionSignature(request)) ?? false;
}

/** Clears the memo (one server when given, all servers otherwise); tests. */
export function resetRemembered(serverId?: string): void {
  if (serverId === undefined) remembered.clear();
  else remembered.delete(serverId);
}
