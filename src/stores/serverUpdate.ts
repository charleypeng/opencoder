// Server update hint store (TASK-M8-09): per-server `installation.update-
// available` SSE events land here so DesktopShell can render a dismissible
// banner ("Server update available: vX — restart opencode serve to apply").
// The hint only means the SERVER (opencode serve) has a newer version
// available — the app itself cannot update the server, the banner is pure
// information. `installation.updated` clears the hint (the server upgraded
// itself). `current` is the server's running version when the health
// monitor snapshot knows it; the event payload itself only carries
// `version` (verified against the 1.18.11 schema).

import { createStore, produce } from "solid-js/store";

export interface ServerUpdateInfo {
  /** The server version available for upgrade. */
  version: string;
  /** The running server version when known (health monitor snapshot). */
  current?: string;
}

export type ServerUpdateMap = Record<string, ServerUpdateInfo | null>;

const [serverUpdate, setServerUpdate] = createStore<ServerUpdateMap>({});

/** Latest update hint per server id (null = dismissed or none). */
export { serverUpdate };

/** Non-reactive read of one server's update hint. */
export function getServerUpdate(serverId: string): ServerUpdateInfo | null | undefined {
  return serverUpdate[serverId];
}

/** Applies an `installation.update-available` payload (non-empty version). */
export function applyServerUpdate(serverId: string, info: ServerUpdateInfo): void {
  if (typeof serverId !== "string" || serverId === "") return;
  if (typeof info?.version !== "string" || info.version === "") return;
  setServerUpdate(serverId, {
    version: info.version,
    current: typeof info.current === "string" ? info.current : undefined,
  });
}

/** Clears the hint (dismissed in the UI, or the server updated itself). */
export function clearServerUpdate(serverId: string): void {
  setServerUpdate(serverId, null);
}

/** Drops the hint entry entirely (distinct from the dismissed null marker;
 *  mirrors the resetServer discipline of the other per-server stores). */
export function resetServerUpdate(serverId: string): void {
  setServerUpdate(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
