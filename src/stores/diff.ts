// Diff store (TASK-M4-07): per-server, per-session session-diff payloads
// fed by GET /session/{id}/diff and the `session.diff` SSE event. A payload
// is a SnapshotFileDiff[] (per-file stats plus optional patch text). The
// store keeps the latest payload per session and a `version` counter:
// a session.diff event can carry a fresh payload (applyDiff) or nothing
// beyond the session id (bumpDiffVersion), and mounted DiffView views
// refetch on the version change — the server's snapshot is the source of
// truth, the store only signals and caches.

import { createStore, produce } from "solid-js/store";
import type { SnapshotFileDiff } from "../services/vcs.js";

export interface DiffSessionState {
  diffs: SnapshotFileDiff[];
  /** Bumped by every session.diff event; DiffView refetches on change. */
  version: number;
}

export type DiffMap = Record<string, Record<string, DiffSessionState>>;

const [diffs, setDiffs] = createStore<DiffMap>({});

/** Reactive per-server/session diff state (bucket absent until first event). */
export { diffs };

/** Non-reactive read of one session's diff state bucket. */
export function getServerDiffState(
  serverId: string,
  sessionId: string,
): DiffSessionState | undefined {
  return diffs[serverId]?.[sessionId];
}

/** Replaces a session's diff payload and bumps its version. */
export function applyDiff(serverId: string, sessionId: string, payload: SnapshotFileDiff[]): void {
  if (!Array.isArray(payload)) return;
  setDiffs(
    produce((draft) => {
      const server = draft[serverId] ?? {};
      const entry = server[sessionId] ?? { diffs: [], version: 0 };
      server[sessionId] = { diffs: payload, version: entry.version + 1 };
      draft[serverId] = server;
    }),
  );
}

/** Bumps a session's version without a payload (refresh-only event);
 *  sessions without any stored state are left untouched. */
export function bumpDiffVersion(serverId: string, sessionId: string): void {
  setDiffs(
    produce((draft) => {
      const server = draft[serverId];
      const entry = server?.[sessionId];
      if (server === undefined || entry === undefined) return;
      server[sessionId] = { diffs: entry.diffs, version: entry.version + 1 };
      draft[serverId] = server;
    }),
  );
}

/** Clears all diff state for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setDiffs(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
