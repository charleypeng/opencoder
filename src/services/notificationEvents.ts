// Notification event wiring (TASK-M8-06): translates store state changes
// into system notifications. The three pure mappings (generationCompleted /
// queueGainedItem / shouldNotify) are unit-tested; startNotifications
// watches the live per-server session statuses, permission queue and
// question queue and fires the notification facade. First observations
// never fire (a snapshot on mount is not an event) — only transitions
// after a baseline, mirroring the hapticEvents discipline. The send gate
// (window unfocused + master switch + per-server switch) is applied per
// fire; the facade itself is a no-op outside Tauri and on permission
// denial. DesktopShell mounts the watcher for the active server; mobile
// reuses the same watcher + facade (M7).

import { createEffect, createRoot } from "solid-js";
import type { SessionStatusEntry } from "../stores/session.js";
import { getServerSessionState } from "../stores/session.js";
import { permissions } from "../stores/permission.js";
import { questions } from "../stores/question.js";
import {
  loadNotificationPrefs,
  notificationsEnabled,
  serverNotificationsEnabled,
} from "../stores/notifications.js";
import { isWindowFocused, notify } from "./notifications.js";
import { useT } from "../i18n/index.js";

/** True when a generating session (busy/retry) turns idle — the moment a
 *  generation completes. The first observation (no previous status) is
 *  never an event. */
export function generationCompleted(
  prev: SessionStatusEntry | undefined,
  next: SessionStatusEntry | undefined,
): boolean {
  if (prev === undefined || next === undefined) return false;
  const wasGenerating = prev.type === "busy" || prev.type === "retry";
  return wasGenerating && next.type === "idle";
}

/** True when the queue gains an id it did not have before (a NEW pending
 *  item). The first observation is not an event. */
export function queueGainedItem(
  prev: readonly string[] | undefined,
  next: readonly string[],
): boolean {
  if (prev === undefined) return false;
  return next.some((id) => !prev.includes(id));
}

/** The notification send gate: only while the window is NOT focused (the
 *  user is elsewhere — an in-focus completion is already on screen), the
 *  master switch is on and the server's own switch is on. */
export function shouldNotify(focused: boolean, enabled: boolean, serverEnabled: boolean): boolean {
  return !focused && enabled && serverEnabled;
}

/** The session's display title (title, falling back to slug, then id). */
function titleOf(serverId: string, sessionId: string): string {
  const session = getServerSessionState(serverId).sessions[sessionId];
  return session ? session.title || session.slug || sessionId : sessionId;
}

/** Applies the prefs + focus gate, then sends the notification payload.
 *  Both checks are read at fire time so a mid-session toggle takes
 *  effect immediately. */
async function maybeNotify(
  serverId: string,
  build: () => { title: string; body?: string },
): Promise<void> {
  const prefs = loadNotificationPrefs();
  if (
    !shouldNotify(
      await isWindowFocused(),
      notificationsEnabled(prefs),
      serverNotificationsEnabled(serverId, prefs),
    )
  ) {
    return;
  }
  const payload = build();
  void notify({ title: payload.title, body: payload.body });
}

/**
 * Watches the given server's session statuses, permission queue and
 * question queue and fires system notifications on transitions. Returns a
 * dispose function. The baselines (previous status per session id, previous
 * permission/question id lists) are captured SYNCHRONOUSLY at start —
 * state already present at mount is a snapshot, never an event; anything
 * arriving afterwards fires (subject to the prefs + focus gate). Each
 * effect run diffs only its own session/per-server keys, so one session's
 * churn never affects its peers.
 */
export function startNotifications(serverId: string): () => void {
  const t = useT();
  return createRoot((dispose) => {
    // Baseline snapshots taken at mount time (effects run on Solid's own
    // flush, which is deferred; the snapshot must not be an event).
    const prevStatuses = new Map(Object.entries(getServerSessionState(serverId).statuses));
    let prevPermissionIds: readonly string[] | undefined = (permissions[serverId]?.queue ?? []).map(
      (request) => request.id,
    );
    let prevQuestionIds: readonly string[] | undefined = (questions[serverId]?.queue ?? []).map(
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
        const previous = prevStatuses.get(sessionId);
        if (generationCompleted(previous, entry)) {
          void maybeNotify(serverId, () => ({
            title: t("notifications:generationComplete"),
            body: titleOf(serverId, sessionId),
          }));
        }
        prevStatuses.set(sessionId, entry);
      }
    });

    createEffect(() => {
      const queue = permissions[serverId]?.queue ?? [];
      const ids = queue.map((request) => request.id);
      if (queueGainedItem(prevPermissionIds, ids)) {
        const added = queue.find((request) => !prevPermissionIds?.includes(request.id));
        void maybeNotify(serverId, () => ({
          title: t("notifications:permissionRequested"),
          body: added !== undefined ? titleOf(serverId, added.sessionID) : undefined,
        }));
      }
      prevPermissionIds = ids;
    });

    createEffect(() => {
      const queue = questions[serverId]?.queue ?? [];
      const ids = queue.map((request) => request.id);
      if (queueGainedItem(prevQuestionIds, ids)) {
        const added = queue.find((request) => !prevQuestionIds?.includes(request.id));
        void maybeNotify(serverId, () => ({
          title: t("notifications:questionAsked"),
          body: added !== undefined ? titleOf(serverId, added.sessionID) : undefined,
        }));
      }
      prevQuestionIds = ids;
    });

    return dispose;
  });
}
