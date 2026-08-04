// Haptic event wiring (TASK-M7-07): translates store state changes into
// the four haptic kinds. The two pure mappings (statusHaptic /
// permissionHaptic) are unit-tested; startHapticEvents watches the live
// per-server session statuses and permission queue and fires the facade.
// First observations never fire (a snapshot on mount is not an event) —
// only transitions after a baseline. The watcher is mounted by
// MobileShell (mobile form factor; haptic() itself is a no-op elsewhere).

import { createEffect, createRoot } from "solid-js";
import type { SessionStatusEntry } from "../stores/session.js";
import { getServerSessionState } from "../stores/session.js";
import { permissions } from "../stores/permission.js";
import { haptic } from "./haptics.js";
import type { HapticKind } from "./haptics.js";

/** Maps a session status transition to a haptic kind; null when the
 *  transition is not noteworthy. The first observation (no previous
 *  status) is never an event. */
export function statusHaptic(
  prev: SessionStatusEntry | undefined,
  next: SessionStatusEntry | undefined,
): HapticKind | null {
  if (prev === undefined || next === undefined) return null;
  if (next.type === "error") return "error";
  const wasGenerating = prev.type === "busy" || prev.type === "retry";
  if (wasGenerating && next.type === "idle") return "complete";
  return null;
}

/** Maps a permission queue change to a haptic kind; fires only when a NEW
 *  request id appears (enqueue). The first observation is not an event. */
export function permissionHaptic(
  prev: readonly string[] | undefined,
  next: readonly string[],
): HapticKind | null {
  if (prev === undefined) return null;
  if (next.some((id) => !prev.includes(id))) return "permission";
  return null;
}

/**
 * Watches the given server's session statuses and permission queue and
 * fires haptics on transitions. Returns a dispose function. The baseline
 * (previous status per session id, previous permission id list) is
 * captured SYNCHRONOUSLY at start — state already present at mount is a
 * snapshot, never an event; anything arriving afterwards fires. Each
 * effect run diffs only its own session/per-server keys, so one session's
 * churn never affects its peers.
 */
export function startHapticEvents(serverId: string): () => void {
  return createRoot((dispose) => {
    // Baseline snapshots taken at mount time (effects run on Solid's own
    // flush, which is deferred; the snapshot must not be an event).
    const prevStatuses = new Map(Object.entries(getServerSessionState(serverId).statuses));
    let prevPermissionIds: readonly string[] | undefined = (permissions[serverId]?.queue ?? []).map(
      (request) => request.id,
    );

    createEffect(() => {
      const { sessions, statuses } = getServerSessionState(serverId);
      // Prune baselines of sessions deleted from the store: a reused id
      // must start a fresh baseline (a stale one would fire a spurious
      // "complete" from the deleted session) and the map must not grow
      // unbounded.
      for (const sessionId of prevStatuses.keys()) {
        if (!(sessionId in sessions)) prevStatuses.delete(sessionId);
      }
      for (const [sessionId, entry] of Object.entries(statuses)) {
        const kind = statusHaptic(prevStatuses.get(sessionId), entry);
        if (kind !== null) void haptic(kind);
        prevStatuses.set(sessionId, entry);
      }
    });

    createEffect(() => {
      const ids = (permissions[serverId]?.queue ?? []).map((request) => request.id);
      const kind = permissionHaptic(prevPermissionIds, ids);
      if (kind !== null) void haptic(kind);
      prevPermissionIds = ids;
    });

    return dispose;
  });
}
