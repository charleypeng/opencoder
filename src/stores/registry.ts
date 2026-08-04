// Registry store (TASK-M1-08): the active server context. Every per-server
// store (connection, sessions, messages, ...) keys off activeServerId, so
// entering a server injects the context into the whole store layer and
// switching servers never mixes data between them.

import { createStore } from "solid-js/store";

interface RegistryState {
  activeServerId: string | null;
}

const [registry, setRegistry] = createStore<RegistryState>({ activeServerId: null });

/** Reactive active-server context; null when no workspace is open. */
export { registry };

/** Sets the active server context (null clears it). */
export function setActiveServer(id: string | null): void {
  setRegistry("activeServerId", id);
}

/** Non-reactive read of the active server id. */
export function getActiveServerId(): string | null {
  return registry.activeServerId;
}
