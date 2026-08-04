// Permission store (TASK-M5-01): per-server queue of pending permission
// requests (architecture.md §5), fed by the `permission.asked` SSE event
// (enqueue, deduped by id) and the initial GET /permission list (applyList),
// drained by `permission.replied` events and the sheet's own reply POST
// (dequeue by id — both paths are idempotent). `version` bumps on every
// change so mounted permission sheets always see the latest queue head.

import { createStore, produce } from "solid-js/store";
import type { PermissionRequest } from "../services/permission.js";

export interface PermissionServerState {
  /** Pending requests in arrival order; the head is shown to the user. */
  queue: PermissionRequest[];
  /** Bumped on every queue change; drives the sheet's re-render. */
  version: number;
}

export type PermissionMap = Record<string, PermissionServerState>;

const [permissions, setPermissions] = createStore<PermissionMap>({});

/** Reactive per-server permission queue state (bucket absent until the first event). */
export { permissions };

/** Non-reactive read of one server's permission queue state. */
export function getServerPermissionState(serverId: string): PermissionServerState | undefined {
  return permissions[serverId];
}

/** Enqueues a pending request; duplicate ids are ignored (idempotent). */
export function enqueue(serverId: string, request: PermissionRequest): void {
  if (request === null || typeof request !== "object" || typeof request.id !== "string") return;
  setPermissions(
    produce((draft) => {
      const server = draft[serverId] ?? { queue: [], version: 0 };
      if (server.queue.some((existing) => existing.id === request.id)) return;
      server.queue = [...server.queue, request];
      server.version += 1;
      draft[serverId] = server;
    }),
  );
}

/** Removes a request from the queue (reply success / permission.replied). */
export function dequeue(serverId: string, requestId: string): void {
  if (typeof requestId !== "string") return;
  setPermissions(
    produce((draft) => {
      const server = draft[serverId];
      if (server === undefined) return;
      const next = server.queue.filter((request) => request.id !== requestId);
      if (next.length === server.queue.length) return;
      server.queue = next;
      server.version += 1;
      draft[serverId] = server;
    }),
  );
}

/** Replaces the whole queue from GET /permission (initial fetch / re-sync). */
export function applyList(serverId: string, requests: PermissionRequest[]): void {
  if (!Array.isArray(requests)) return;
  setPermissions(
    produce((draft) => {
      const server = draft[serverId] ?? { queue: [], version: 0 };
      server.queue = [...requests];
      server.version += 1;
      draft[serverId] = server;
    }),
  );
}

/** Clears a server's queue (drop before full re-sync / context rebuild). */
export function resetServer(serverId: string): void {
  setPermissions(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
