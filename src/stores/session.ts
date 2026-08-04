// Session store (TASK-M2-02): per-server normalized session list mirroring
// the session REST endpoints plus live SSE statuses. Full-list replacements
// come from `syncAll` (triggered by `server.connected`); incremental
// mutations come from `session.*` SSE events via stores/events.ts.
//
// SolidJS stores deep-merge plain objects on set, so every mutation rebuilds
// the affected node inside `produce` where assignment semantics replace the
// target wholesale (no stale keys survive).

import { createStore, produce } from "solid-js/store";
import type { Session, SessionStatus } from "../services/session.js";

/**
 * Status entry: schema `SessionStatus` plus a synthetic "error" variant
 * derived from `session.error` events (not part of the REST schema).
 */
export type SessionStatusEntry = SessionStatus | { type: "error"; message?: string };

export interface ServerSessionState {
  /** Sessions keyed by id, most recently updated first. */
  sessions: Record<string, Session>;
  /** Render order of session ids (descending `time.updated`). */
  order: string[];
  /** Live per-session status (from `/session/status` + status events). */
  statuses: Record<string, SessionStatusEntry>;
  /** Currently viewed session; null when nothing is open. */
  activeSessionId: string | null;
}

export type SessionMap = Record<string, ServerSessionState>;

export const EMPTY_SERVER_SESSION_STATE: ServerSessionState = {
  sessions: {},
  order: [],
  statuses: {},
  activeSessionId: null,
};

const [sessions, setSessions] = createStore<SessionMap>({});

/** Reactive per-server session state. */
export { sessions };

/** Non-reactive read of one server's state bucket. */
export function getServerSessionState(serverId: string): ServerSessionState {
  return sessions[serverId] ?? EMPTY_SERVER_SESSION_STATE;
}

// Fresh nested containers per update: the produce draft must never share
// (and thereby mutate) the module-level EMPTY_* constants.
function freshServerState(): ServerSessionState {
  return { sessions: {}, order: [], statuses: {}, activeSessionId: null };
}

function updateServer(serverId: string, update: (state: ServerSessionState) => void): void {
  setSessions(
    produce((draft) => {
      const state = draft[serverId] ?? freshServerState();
      update(state);
      draft[serverId] = state;
    }),
  );
}

/** Sorts a Session list by most recently updated (stable for ties). */
function byMostRecent(a: Session, b: Session): number {
  return b.time.updated - a.time.updated;
}

/** Replaces the whole session list for a server (full re-sync). */
export function applySessionList(serverId: string, list: Session[]): void {
  const sorted = [...list].sort(byMostRecent);
  updateServer(serverId, (state) => {
    state.sessions = Object.fromEntries(sorted.map((s) => [s.id, s]));
    state.order = sorted.map((s) => s.id);
  });
}

/** Inserts or updates one session (session.created / session.updated). */
export function upsertSession(serverId: string, session: Session): void {
  updateServer(serverId, (state) => {
    state.sessions[session.id] = session;
    if (!state.order.includes(session.id)) state.order.push(session.id);
    // Keep the order most-recently-updated first, like GET /session.
    state.order.sort(
      (a, b) => (state.sessions[b]?.time.updated ?? 0) - (state.sessions[a]?.time.updated ?? 0),
    );
  });
}

/** Removes a session and its status; leaves activeSessionId clearing to the UI. */
export function removeSession(serverId: string, sessionId: string): void {
  updateServer(serverId, (state) => {
    if (!(sessionId in state.sessions)) return;
    delete state.sessions[sessionId];
    state.order = state.order.filter((id) => id !== sessionId);
    delete state.statuses[sessionId];
    if (state.activeSessionId === sessionId) state.activeSessionId = null;
  });
}

/** Applies a session status; accepts the schema object, bare strings, or
 * the synthetic "error" entry (session.error). */
export function setSessionStatus(
  serverId: string,
  sessionId: string,
  status: SessionStatusEntry | string,
): void {
  if (status == null) return;
  // Bare strings (e.g. "error") are normalized into the schema's object
  // form; the cast widens the literal union beyond idle/retry/busy.
  const entry: SessionStatusEntry =
    typeof status === "string" ? ({ type: status } as SessionStatusEntry) : status;
  updateServer(serverId, (state) => {
    state.statuses[sessionId] = entry;
  });
}

/** Replaces the whole status map (`GET /session/status` result). */
export function setStatusMap(serverId: string, statuses: Record<string, SessionStatus>): void {
  updateServer(serverId, (state) => {
    state.statuses = { ...statuses };
  });
}

/** Sets the currently viewed session (null clears it). */
export function setActiveSession(serverId: string, sessionId: string | null): void {
  updateServer(serverId, (state) => {
    state.activeSessionId = sessionId;
  });
}

/** Clears all sessions/statuses for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setSessions(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
