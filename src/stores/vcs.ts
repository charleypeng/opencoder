// VCS store (TASK-M4-08): per-server branch + working-tree change list, fed
// by GET /vcs, GET /vcs/status and the `vcs.branch.updated` SSE event.
// Branch and change payloads are applied as snapshots (applyVcs/applyStatus
// never bump the version), while a branch event (applyBranch) also bumps
// `version` — a checkout changes the working tree, so mounted VCS panels
// refetch status. `refresh` is the manual bump behind the panel's Refresh
// button; the status-bar branch chip reads the same reactive store.

import { createStore, produce } from "solid-js/store";
import type { VcsFileStatus, VcsInfo } from "../services/vcs.js";

export interface VcsServerState {
  /** Active branch; null when the workspace is not a git repository. */
  branch: string | null;
  /** Working-tree changes (file, status, per-file addition/deletion counts). */
  changes: VcsFileStatus[];
  /** Bumped by branch events / manual refresh; mounted panels refetch. */
  version: number;
}

export type VcsMap = Record<string, VcsServerState>;

const [vcs, setVcs] = createStore<VcsMap>({});

/** Reactive per-server VCS state (bucket absent until the first fetch). */
export { vcs };

/** Non-reactive read of one server's VCS state bucket. */
export function getServerVcsState(serverId: string): VcsServerState | undefined {
  return vcs[serverId];
}

/** Applies GET /vcs branch info; a missing/empty branch marks a non-git
 *  workspace (no version bump — this is a snapshot write, not a delta). */
export function applyVcs(serverId: string, info: VcsInfo | undefined | null): void {
  const branch = typeof info?.branch === "string" && info.branch !== "" ? info.branch : null;
  setVcs(
    produce((draft) => {
      const server = draft[serverId] ?? { branch: null, changes: [], version: 0 };
      server.branch = branch;
      draft[serverId] = server;
    }),
  );
}

/** Replaces the change list from GET /vcs/status (snapshot write). */
export function applyStatus(serverId: string, entries: VcsFileStatus[]): void {
  if (!Array.isArray(entries)) return;
  setVcs(
    produce((draft) => {
      const server = draft[serverId] ?? { branch: null, changes: [], version: 0 };
      server.changes = entries;
      draft[serverId] = server;
    }),
  );
}

/**
 * Applies a `vcs.branch.updated` event: sets the branch and bumps the
 * version so mounted VCS panels refetch status (the working tree changed).
 */
export function applyBranch(serverId: string, branch: string): void {
  if (typeof branch !== "string" || branch === "") return;
  setVcs(
    produce((draft) => {
      const server = draft[serverId] ?? { branch: null, changes: [], version: 0 };
      server.branch = branch;
      server.version += 1;
      draft[serverId] = server;
    }),
  );
}

/** Manual refresh: bumps the version so mounted VCS panels refetch. */
export function refresh(serverId: string): void {
  setVcs(
    produce((draft) => {
      const server = draft[serverId];
      if (server === undefined) return;
      server.version += 1;
      draft[serverId] = server;
    }),
  );
}

/** Clears all VCS state for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setVcs(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
