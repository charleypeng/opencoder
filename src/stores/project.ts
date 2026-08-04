// Project store (TASK-M2-02): per-server project list plus the active
// directory. `current` holds the worktree path string — it feeds the
// client's global `?directory=` injection (TASK-M2-03 wires getDirectory)
// and the per-directory SSE stream.

import { createStore, produce } from "solid-js/store";
import type { Project } from "../services/project.js";

export interface ServerProjectState {
  /** Projects opened with this server, in list order. */
  projects: Project[];
  /** Active directory path; null when nothing is open. */
  current: string | null;
}

export type ProjectMap = Record<string, ServerProjectState>;

export const EMPTY_SERVER_PROJECT_STATE: ServerProjectState = { projects: [], current: null };

const [projects, setProjects] = createStore<ProjectMap>({});

/** Reactive per-server project state. */
export { projects };

/** Non-reactive read of one server's state bucket. */
export function getServerProjectState(serverId: string): ServerProjectState {
  return projects[serverId] ?? EMPTY_SERVER_PROJECT_STATE;
}

// Fresh container per update: the produce draft must never share (and
// thereby mutate) the module-level EMPTY_* constant.
function freshServerState(): ServerProjectState {
  return { projects: [], current: null };
}

function updateServer(serverId: string, update: (state: ServerProjectState) => void): void {
  setProjects(
    produce((draft) => {
      const state = draft[serverId] ?? freshServerState();
      update(state);
      draft[serverId] = state;
    }),
  );
}

/** Replaces the project list for a server (full re-sync). */
export function applyProjects(serverId: string, list: Project[]): void {
  updateServer(serverId, (state) => {
    state.projects = [...list];
  });
}

/** Sets the active directory path (null clears it). */
export function setCurrent(serverId: string, directory: string | null): void {
  updateServer(serverId, (state) => {
    state.current = directory;
  });
}

/** Clears all projects for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setProjects(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
