// Event routing (TASK-M2-02): the SSE -> store dispatch table (architecture
// §5 "事件 → store 归一化入口"). `applyEvent` is a pure-ish reducer over
// injected store modules so tests can drive it directly; `syncAll` performs
// the full re-sync that `server.connected` triggers (session list + status
// map + projects + current directory); `subscribeToServerEvents` wires the
// SSE stream to the router and resets per-server state before each re-sync.

import type { components } from "../services/api/schema.js";
import {
  createSessionService,
  type Session,
  type SessionService,
  type SessionStatus,
} from "../services/session.js";
import { createProjectService, type Project, type ProjectService } from "../services/project.js";
import { getApiClient } from "../services/client.js";
import { sseSubscribe, type SseEvent } from "../services/sse.js";
import * as sessionStore from "./session.js";
import * as messagesStore from "./messages.js";
import * as projectStore from "./project.js";

type Message = components["schemas"]["Message"];
type Part = components["schemas"]["Part"];

/** Store module APIs the router dispatches into (injectable for tests). */
export interface EventStoreDeps {
  session: typeof sessionStore;
  messages: typeof messagesStore;
  project: typeof projectStore;
}

export const defaultEventStores: EventStoreDeps = {
  session: sessionStore,
  messages: messagesStore,
  project: projectStore,
};

/** Best-effort human message from a session.error error payload. */
function errorMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const data = (error as { data?: unknown }).data;
  if (typeof data === "object" && data !== null) {
    const nested = (data as { message?: unknown }).message;
    if (typeof nested === "string") return nested;
  }
  const direct = (error as { message?: unknown }).message;
  return typeof direct === "string" ? direct : undefined;
}

/**
 * Dispatches one SSE event into the store modules. Unknown event types are
 * ignored (logged in dev); `server.connected` is handled by the wire-up
 * helper (full re-sync), not here.
 */
export function applyEvent(
  serverId: string,
  event: SseEvent,
  deps: EventStoreDeps = defaultEventStores,
): void {
  const { session, messages } = deps;
  const p = event.properties ?? {};
  switch (event.type) {
    case "server.connected":
    case "todo.updated":
      // server.connected triggers syncAll in subscribeToServerEvents;
      // todos land in M3-07.
      return;
    case "session.created":
    case "session.updated":
      session.upsertSession(serverId, p.info as Session);
      return;
    case "session.deleted":
      session.removeSession(serverId, p.sessionID as string);
      messages.removeMessage(serverId, p.sessionID as string);
      return;
    case "session.status":
      session.setSessionStatus(serverId, p.sessionID as string, p.status as SessionStatus | string);
      return;
    case "session.idle":
      session.setSessionStatus(serverId, p.sessionID as string, { type: "idle" });
      return;
    case "session.error":
      if (typeof p.sessionID === "string") {
        const message = errorMessage(p.error);
        session.setSessionStatus(
          serverId,
          p.sessionID,
          message === undefined ? { type: "error" } : { type: "error", message },
        );
      }
      return;
    case "message.updated":
      messages.upsertMessage(serverId, p.sessionID as string, p.info as Message);
      return;
    case "message.part.updated":
      messages.applyPartDelta(serverId, p.sessionID as string, p.part as Part);
      return;
    case "message.part.delta":
      messages.applyTextDelta(serverId, p.sessionID as string, {
        messageID: p.messageID as string,
        partID: p.partID as string,
        field: p.field as string,
        delta: p.delta as string,
      });
      return;
    case "message.part.removed":
      messages.removePart(serverId, p.sessionID as string, p.partID as string);
      return;
    case "message.removed":
      messages.removePartsForMessage(serverId, p.sessionID as string, p.messageID as string);
      return;
    default:
      if (import.meta.env.DEV) {
        console.debug(`[stores] ignoring SSE event type "${event.type}"`);
      }
      return;
  }
}

/** Services needed for a full re-sync (subset of the domain services). */
export interface SyncServices {
  session: Pick<SessionService, "list" | "statusAll">;
  project: Pick<ProjectService, "list" | "current">;
}

export interface SyncResult {
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
  projects: Project[];
  /** Active directory path; null when the server has no current project. */
  current: string | null;
}

/**
 * Full re-sync: pulls session list + status map + project list + current
 * project in parallel and applies them to the stores.
 */
export async function syncAll(
  serverId: string,
  dir: string | undefined,
  services: SyncServices,
  deps: EventStoreDeps = defaultEventStores,
): Promise<SyncResult> {
  const [sessionList, statuses, projectList, currentProject] = await Promise.all([
    services.session.list(dir),
    services.session.statusAll(dir),
    services.project.list(dir),
    services.project.current(dir),
  ]);
  deps.session.applySessionList(serverId, sessionList);
  deps.session.setStatusMap(serverId, statuses);
  deps.project.applyProjects(serverId, projectList);
  deps.project.setCurrent(serverId, currentProject?.worktree ?? null);
  return {
    sessions: sessionList,
    statuses,
    projects: projectList,
    current: currentProject?.worktree ?? null,
  };
}

function defaultSyncServices(): SyncServices {
  const client = getApiClient();
  return {
    session: createSessionService(client),
    project: createProjectService(client),
  };
}

export interface SubscribeToServerEventsResult {
  unsubscribe: () => Promise<void>;
  /** Manual full re-sync (used right after entering a server). */
  sync: () => Promise<SyncResult>;
}

/**
 * Subscribes to a server's SSE stream and routes every event into the
 * stores. On `server.connected` (initial connect and every reconnect) the
 * per-server stores are reset and a full re-sync runs; events arriving
 * during the re-sync apply on top of the fresh snapshot.
 */
export async function subscribeToServerEvents(
  serverId: string,
  directoryProvider: () => string | undefined,
  options: { services?: SyncServices; deps?: EventStoreDeps } = {},
): Promise<SubscribeToServerEventsResult> {
  const services = options.services ?? defaultSyncServices();
  const deps = options.deps ?? defaultEventStores;
  const unsubscribe = await sseSubscribe(serverId, directoryProvider(), (event) => {
    if (event.type === "server.connected") {
      // Drop local per-server state, then pull fresh snapshots (see syncAll).
      deps.session.resetServer(serverId);
      deps.messages.resetServer(serverId);
      deps.project.resetServer(serverId);
      syncAll(serverId, directoryProvider(), services, deps).catch(() => {
        // A failed re-sync must not break the SSE stream; the next
        // event (or a manual sync call) heals the stores.
      });
    }
    applyEvent(serverId, event, deps);
  });
  return {
    unsubscribe,
    sync: () => syncAll(serverId, directoryProvider(), services, deps),
  };
}
