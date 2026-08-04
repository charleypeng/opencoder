// PTY store (TASK-M6-01): per-server PTY list mirroring `GET /pty` plus the
// `pty.*` SSE events (routed in stores/events.ts). Full-list replacements
// come from `syncAll`-style fetches; incremental mutations come from
// `pty.created` / `pty.updated` / `pty.exited` / `pty.deleted`. The terminal
// panel (TASK-M6-02) consumes this list to build its tabs.
//
// SolidJS stores deep-merge plain objects on set, so every mutation rebuilds
// the affected node inside `produce` where assignment semantics replace the
// target wholesale (no stale keys survive).

import { createStore, produce } from "solid-js/store";
import type { Pty } from "../services/pty.js";

export interface ServerPtyState {
  /** PTYs keyed by id. */
  ptys: Record<string, Pty>;
  /** Render order of pty ids (insertion order). */
  order: string[];
}

export type PtyMap = Record<string, ServerPtyState>;

export const EMPTY_SERVER_PTY_STATE: ServerPtyState = {
  ptys: {},
  order: [],
};

const [ptys, setPtys] = createStore<PtyMap>({});

/** Reactive per-server PTY state. */
export { ptys };

/** Non-reactive read of one server's state bucket. */
export function getServerPtyState(serverId: string): ServerPtyState {
  return ptys[serverId] ?? EMPTY_SERVER_PTY_STATE;
}

// Fresh nested containers per update: the produce draft must never share
// (and thereby mutate) the module-level EMPTY_* constants.
function freshServerState(): ServerPtyState {
  return { ptys: {}, order: [] };
}

function updateServer(serverId: string, update: (state: ServerPtyState) => void): void {
  setPtys(
    produce((draft) => {
      const state = draft[serverId] ?? freshServerState();
      update(state);
      draft[serverId] = state;
    }),
  );
}

/** Replaces the whole PTY list for a server (full re-sync). */
export function applyPtyList(serverId: string, list: Pty[]): void {
  updateServer(serverId, (state) => {
    state.ptys = Object.fromEntries(list.map((pty) => [pty.id, pty]));
    state.order = list.map((pty) => pty.id);
  });
}

/** Inserts or updates one PTY (pty.created / pty.updated). */
export function upsertPty(serverId: string, pty: Pty): void {
  updateServer(serverId, (state) => {
    state.ptys[pty.id] = pty;
    if (!state.order.includes(pty.id)) state.order.push(pty.id);
  });
}

/** Marks a PTY as exited (pty.exited event: { id, exitCode }). */
export function markPtyExited(serverId: string, ptyId: string, exitCode?: number): void {
  updateServer(serverId, (state) => {
    const pty = state.ptys[ptyId];
    if (!pty) return;
    state.ptys[ptyId] = {
      ...pty,
      status: "exited",
      ...(exitCode !== undefined ? { exitCode } : {}),
    };
  });
}

/** Removes a PTY (pty.deleted event or DELETE /pty/{id} flow). */
export function removePty(serverId: string, ptyId: string): void {
  updateServer(serverId, (state) => {
    if (!(ptyId in state.ptys)) return;
    delete state.ptys[ptyId];
    state.order = state.order.filter((id) => id !== ptyId);
  });
}

/** Clears all PTYs for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setPtys(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
