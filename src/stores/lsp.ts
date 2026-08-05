// LSP store (TASK-M9-07): per-server LSP + formatter status for the status
// bar chips. The `lsp.updated` SSE event carries an empty properties
// object (verified against the 1.18.11 EventLspUpdated schema), so the
// event only bumps a version counter — the mounted status bar refetches
// GET /lsp and the store keeps the last known lists for rendering. There
// is no formatter event; GET /formatter is fetched once per mount.

import { createStore, produce } from "solid-js/store";
import type { FormatterStatus, LSPStatus } from "../services/lsp.js";

export interface LspServerState {
  /** Last known LSP statuses (GET /lsp result; empty until first fetch). */
  lsp: LSPStatus[];
  /** Last known formatter statuses (GET /formatter result). */
  formatters: FormatterStatus[];
  /** Bumped by every lsp.updated event; the chip refetches on change. */
  version: number;
  /** Whether a GET /lsp fetch has landed at least once. */
  loaded: boolean;
  /** Whether a GET /formatter fetch has landed at least once. */
  formattersLoaded: boolean;
}

export type LspMap = Record<string, LspServerState>;

const [lsp, setLsp] = createStore<LspMap>({});

/** Reactive per-server LSP state (bucket absent until first apply/bump). */
export { lsp };

/** Non-reactive read of one server's LSP state (empty defaults). */
export function getLspState(serverId: string): LspServerState {
  return (
    lsp[serverId] ?? { lsp: [], formatters: [], version: 0, loaded: false, formattersLoaded: false }
  );
}

/** Applies a GET /lsp result (also marks the server as loaded). */
export function applyLsp(serverId: string, statuses: LSPStatus[]): void {
  setLsp(
    produce((draft) => {
      const entry = draft[serverId] ?? {
        lsp: [],
        formatters: [],
        version: 0,
        loaded: false,
        formattersLoaded: false,
      };
      draft[serverId] = { ...entry, lsp: statuses, loaded: true };
    }),
  );
}

/** Applies a GET /formatter result (also marks the server as loaded). */
export function applyFormatters(serverId: string, formatters: FormatterStatus[]): void {
  setLsp(
    produce((draft) => {
      const entry = draft[serverId] ?? {
        lsp: [],
        formatters: [],
        version: 0,
        loaded: false,
        formattersLoaded: false,
      };
      draft[serverId] = { ...entry, formatters, formattersLoaded: true };
    }),
  );
}

/** Bumps a server's LSP version (refresh-only event: no payload data). */
export function bumpLspVersion(serverId: string): void {
  setLsp(
    produce((draft) => {
      const entry = draft[serverId] ?? {
        lsp: [],
        formatters: [],
        version: 0,
        loaded: false,
        formattersLoaded: false,
      };
      draft[serverId] = { ...entry, version: entry.version + 1 };
    }),
  );
}

/** Clears all LSP state for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setLsp(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
