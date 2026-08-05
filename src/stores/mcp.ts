// Mcp store (TASK-M9-06): per-server refresh signal fed by the
// `mcp.tools.changed` SSE event. The event carries only the server name
// (verified against the 1.18.11 EventMcpToolsChanged schema), so the store
// cannot update tool counts itself — it bumps a version counter and the
// mounted MCP settings section refetches GET /mcp. The server's status map
// is the source of truth; the store only signals.

import { createStore, produce } from "solid-js/store";

export interface McpServerState {
  /** Bumped by every mcp.tools.changed event; the section refetches on change. */
  version: number;
}

export type McpMap = Record<string, McpServerState>;

const [mcp, setMcp] = createStore<McpMap>({});

/** Reactive per-server MCP refresh state (bucket absent until first event). */
export { mcp };

/** Reactive read of one server's MCP version counter (0 before any event). */
export function getMcpVersion(serverId: string): number {
  return mcp[serverId]?.version ?? 0;
}

/** Bumps a server's MCP version so a mounted section refetches the status
 *  map (a refresh-only event: the payload carries no status data). */
export function bumpMcpVersion(serverId: string): void {
  setMcp(
    produce((draft) => {
      const entry = draft[serverId] ?? { version: 0 };
      draft[serverId] = { version: entry.version + 1 };
    }),
  );
}

/** Clears all MCP state for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setMcp(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
