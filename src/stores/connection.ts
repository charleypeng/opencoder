// Connection store (TASK-M1-04): mirrors the Rust health monitor's
// `server-health` events into a module-level SolidJS store so UI components
// render per-server status, version and latency without extra IPC. The Rust
// side owns the 15s polling; this store only applies emitted snapshots.

import { listen } from "@tauri-apps/api/event";
import { createStore, produce } from "solid-js/store";

export type HealthStatus = "ok" | "slow" | "down";

/** Health snapshot of one server, matching the Rust `ServerHealth` payload. */
export interface ConnectionState {
  serverId: string;
  healthy: boolean;
  version?: string;
  latencyMs?: number;
  status: HealthStatus;
  lastOk?: number;
  failCount: number;
  /** True when the last probe was rejected 401/403 — the saved credentials
   *  are no longer accepted (TASK-UI-01). */
  authRequired?: boolean;
}

export type ConnectionMap = Record<string, ConnectionState>;

const [connections, setConnections] = createStore<ConnectionMap>({});

/** Latest health snapshot per server id. */
export { connections };

/** Applies one `server-health` payload to the store. */
export function applyServerHealth(health: ConnectionState): void {
  setConnections(health.serverId, health);
}

/** Clears every stored health snapshot (test isolation / full reset). */
export function resetConnections(): void {
  setConnections(
    produce((draft) => {
      for (const key of Object.keys(draft)) delete draft[key];
    }),
  );
}

/**
 * Subscribes to the Rust `server-health` events (emitted per server on state
 * change) and applies them to the store. Returns an unlisten function.
 * Outside Tauri (plain browser / tests without the IPC bridge) it is a
 * no-op.
 */
export function subscribeToServerHealth(): () => void {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) {
    return () => {};
  }
  const unlisten = listen<ConnectionState>("server-health", (event) => {
    applyServerHealth(event.payload);
  });
  return () => {
    void unlisten.then((unlisten) => unlisten());
  };
}
