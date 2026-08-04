// Agent store (TASK-M5-04): per-server agent catalog from GET /agent plus
// the per-session agent choice. The catalog is a full-list replacement
// (setAgents); selections are recorded per session so switching sessions
// restores each session's agent (the server has no per-session agent
// PATCH, so the choice lives client-side). Resolving a session's agent
// falls back from the recorded selection to the session's own agent (when
// it is still visible) and finally to the first visible agent.

import { createStore, produce } from "solid-js/store";
import type { Agent } from "../services/agent.js";
import { visibleAgents } from "../features/models/agents.js";

export interface ServerAgentState {
  /** Full catalog from GET /agent (incl. hidden agents). */
  agents: Agent[];
  /** A catalog was fetched successfully (fetch failures stay false). */
  loaded: boolean;
  /** Per-session agent selection keyed by session id. */
  activeBySession: Record<string, string>;
}

export type AgentStateMap = Record<string, ServerAgentState>;

export const EMPTY_SERVER_AGENT_STATE: ServerAgentState = {
  agents: [],
  loaded: false,
  activeBySession: {},
};

const [agentStates, setAgentStates] = createStore<AgentStateMap>({});

/** Reactive per-server agent state. */
export { agentStates };

/** Non-reactive read of one server's state bucket. */
export function getServerAgentState(serverId: string): ServerAgentState {
  return agentStates[serverId] ?? EMPTY_SERVER_AGENT_STATE;
}

/** Replaces the catalog from GET /agent (marks the server as loaded). */
export function setAgents(serverId: string, agents: Agent[]): void {
  setAgentStates(
    produce((draft) => {
      const state = draft[serverId] ?? { agents: [], loaded: false, activeBySession: {} };
      state.agents = [...agents];
      state.loaded = true;
      draft[serverId] = state;
    }),
  );
}

/** Records the agent choice for one session (persists per session). */
export function setAgentForSession(serverId: string, sessionId: string, name: string): void {
  setAgentStates(
    produce((draft) => {
      const state = draft[serverId] ?? { agents: [], loaded: false, activeBySession: {} };
      state.activeBySession[sessionId] = name;
      draft[serverId] = state;
    }),
  );
}

/**
 * Resolves the effective agent name for a session: the recorded selection
 * first (dropped when the agent vanished from the catalog), then the
 * session's own agent when still visible, then the first visible agent.
 * Null when the server exposes no usable agent.
 */
export function agentNameFor(
  serverId: string,
  sessionId: string,
  sessionAgent?: string,
): string | null {
  const state = getServerAgentState(serverId);
  const visible = visibleAgents(state.agents);
  const selected = state.activeBySession[sessionId];
  if (selected !== undefined && visible.some((agent) => agent.name === selected)) {
    return selected;
  }
  if (sessionAgent !== undefined && visible.some((agent) => agent.name === sessionAgent)) {
    return sessionAgent;
  }
  return visible[0]?.name ?? null;
}

/** Clears all agent state for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setAgentStates(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
