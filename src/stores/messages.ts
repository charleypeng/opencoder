// Messages store (TASK-M2-02): per-server normalized message/part tables
// fed by `message.*` and `message.part.*` SSE events. Parts are keyed by id
// with an explicit `order` array so streamed deltas update a single part in
// O(1) (no list scanning), while render order stays stable.
//
// `message.part.updated` carries the FULL part state and therefore replaces
// the stored part wholesale; `message.part.delta` appends to string fields
// ("text"/"output") and replaces anything else.
//
// TASK-M2-08 optimistic reconciliation: a local-* message inserted by the
// prompt box is tracked here until its server echo arrives; the first user
// echo for the session rolls it over onto the echoed message (see
// reconcilePending, called from upsertMessage and from the part-first
// paths). An echo that already carries its own text replaces the optimistic
// message entirely; a non-user message leaves both the marker and the local
// message pending until the real echo arrives. A prompt the server never
// echoes keeps its optimistic bubble and marker until the next send
// replaces it — same as a silent server.

import { createStore, produce } from "solid-js/store";
import type { components } from "../services/api/schema.js";

export type Message = components["schemas"]["Message"];
export type Part = components["schemas"]["Part"];

export interface SessionMessages {
  /** Most recent message metadata; null until known. */
  info: Message | null;
  /** All known message metadata keyed by message id (history rendering). */
  infos: Record<string, Message>;
  /** Parts keyed by part id (delta updates hit one node, O(1)). */
  parts: Record<string, Part>;
  /** Render order of part ids. */
  order: string[];
}

export type MessagesMap = Record<string, Record<string, SessionMessages>>;

const [messages, setMessages] = createStore<MessagesMap>({});

/** Reactive per-server message tables (server -> session -> messages). */
export { messages };

/** Non-reactive read of one server's session bucket. */
export function getServerMessages(serverId: string): Record<string, SessionMessages> {
  return messages[serverId] ?? {};
}

// Fresh nested containers per update: the produce draft must never share
// (and thereby mutate) the module-level EMPTY_* constants.
function freshSessionMessages(): SessionMessages {
  return { info: null, infos: {}, parts: {}, order: [] };
}

// Pending optimistic local message ids per (server, session), registered by
// PromptBox on send and consumed by the first real server message after it.
function pendingKey(serverId: string, sessionId: string): string {
  return `${serverId}:${sessionId}`;
}

const pendingLocalMessages = new Map<string, string>();

/**
 * Registers a local-* message awaiting its server echo (TASK-M2-08). Only
 * the most recent send is tracked per session; a prompt the server never
 * echoes keeps its optimistic bubble and the marker is replaced by the next
 * send or dropped by untrackPendingLocalMessage.
 */
export function trackPendingLocalMessage(
  serverId: string,
  sessionId: string,
  localMessageId: string,
): void {
  pendingLocalMessages.set(pendingKey(serverId, sessionId), localMessageId);
}

/** Drops a session's pending marker (rollback, session switch, unmount). */
export function untrackPendingLocalMessage(serverId: string, sessionId: string): void {
  pendingLocalMessages.delete(pendingKey(serverId, sessionId));
}

function updateServer(
  serverId: string,
  update: (bucket: Record<string, SessionMessages>) => void,
): void {
  setMessages(
    produce((draft) => {
      const bucket = draft[serverId] ?? {};
      update(bucket);
      draft[serverId] = bucket;
    }),
  );
}

/** Inserts a part into the normalized table, appending to order when new. */
function putPart(bucket: Record<string, SessionMessages>, sessionId: string, part: Part): void {
  if (typeof part?.id !== "string") return;
  const entry = bucket[sessionId] ?? freshSessionMessages();
  if (!(part.id in entry.parts)) entry.order.push(part.id);
  entry.parts[part.id] = part;
  bucket[sessionId] = entry;
}

/**
 * Upserts a message (message.updated): replaces the info (both the
 * most-recent slot and the per-message table) and normalizes any parts
 * carried on the info payload (recorded session messages use a
 * { info, parts } shape; the event schema itself has no parts), then runs
 * the pending-message reconciliation (TASK-M2-08, see reconcilePending).
 */
export function upsertMessage(serverId: string, sessionId: string, info: Message): void {
  updateServer(serverId, (bucket) => {
    const entry = bucket[sessionId] ?? freshSessionMessages();
    entry.info = info;
    entry.infos[info.id] = info;
    bucket[sessionId] = entry;
    const carried = (info as Message & { parts?: unknown }).parts;
    if (Array.isArray(carried)) {
      for (const part of carried) putPart(bucket, sessionId, part as Part);
    }
  });
  const carried = (info as Message & { parts?: unknown }).parts;
  reconcilePending(
    serverId,
    sessionId,
    info.id,
    info.role,
    Array.isArray(carried) ? (carried as Part[]) : undefined,
  );
}

/**
 * True while the tracked local message still owns parts in the bucket
 * (i.e. its marker has not been consumed by an earlier reconciliation).
 */
function pendingLocalPartsExist(serverId: string, sessionId: string, pendingId: string): boolean {
  const entry = messages[serverId]?.[sessionId];
  if (entry === undefined) return false;
  return entry.order.some((id) => entry.parts[id]?.messageID === pendingId);
}

/**
 * Part-first reconciliation hook (TASK-M2-08): message.part.updated and
 * message.part.delta for the echo can arrive before message.updated. When a
 * part for a server message lands while the session's marker is pending and
 * the local parts still exist, the same reconcile-if-safe logic runs.
 */
function maybeReconcileOnPart(
  serverId: string,
  sessionId: string,
  messageId: string,
  part?: Part,
): void {
  if (typeof messageId !== "string") return;
  const pendingId = pendingLocalMessages.get(pendingKey(serverId, sessionId));
  if (pendingId === undefined || pendingId === messageId) return;
  if (!pendingLocalPartsExist(serverId, sessionId, pendingId)) return;
  reconcilePending(
    serverId,
    sessionId,
    messageId,
    undefined,
    part === undefined ? undefined : [part],
  );
}

/**
 * Reconciles the pending optimistic local message against the incoming
 * server message (TASK-M2-08), called from upsertMessage and, via
 * maybeReconcileOnPart, from the part-first paths. Idempotent: the marker
 * is cleared once a reconciliation applies, so later messages upsert
 * normally.
 *
 * Reconcile-if-safe conditions, all required:
 * - a pending marker exists for the session and the incoming message is not
 *   the local message itself;
 * - the incoming message is the user echo: role "user", or unknown when a
 *   part triggered the call (parts carry no role);
 * - the echo does not already carry its own text (parts on the info payload
 *   or a stored part under the echo's message id).
 *
 * When the echo has its own text the local message is dropped entirely —
 * the echo replaces it. Otherwise the local parts are re-issued under the
 * echo's prt-* ids; a target id that already exists wins, so the local part
 * is dropped instead of overwriting the server's part, and order is deduped
 * after the rename mapping. A non-user message (assistant reply or history
 * replay) leaves both the marker and the local message in place — the
 * server will send its own user echo later.
 */
function reconcilePending(
  serverId: string,
  sessionId: string,
  incomingMessageId: string,
  incomingRole: string | undefined,
  incomingParts: Part[] | undefined,
): void {
  const key = pendingKey(serverId, sessionId);
  updateServer(serverId, (bucket) => {
    const entry = bucket[sessionId];
    const pendingId = pendingLocalMessages.get(key);
    if (entry === undefined || pendingId === undefined) return;
    if (pendingId === incomingMessageId) return;
    // Only the user echo consumes the marker; an assistant or history
    // message leaves the optimistic message pending for its own echo.
    if (incomingRole !== undefined && incomingRole !== "user") return;
    const echoHasOwnParts =
      (incomingParts?.length ?? 0) > 0 ||
      entry.order.some((id) => entry.parts[id]?.messageID === incomingMessageId);
    if (echoHasOwnParts) {
      // The echo carries its own text: the optimistic bubble is replaced,
      // local-* info, parts and order entries all go away.
      for (const partId of [...entry.order]) {
        if (entry.parts[partId]?.messageID === pendingId) delete entry.parts[partId];
      }
      entry.order = entry.order.filter((id) => id in entry.parts);
      if (entry.info?.id === pendingId) entry.info = null;
      delete entry.infos[pendingId];
      pendingLocalMessages.delete(key);
      bucket[sessionId] = entry;
      return;
    }
    // The echo is metadata-only: re-issue the local text under its prt-*
    // ids. A target id that already exists wins — drop the local part
    // instead of overwriting the server's part.
    const renames = new Map<string, string>();
    for (const partId of [...entry.order]) {
      const part = entry.parts[partId];
      if (part === undefined || part.messageID !== pendingId) continue;
      const to =
        renames.size === 0
          ? `prt-${incomingMessageId}`
          : `prt-${incomingMessageId}-${renames.size}`;
      if (to in entry.parts) {
        delete entry.parts[partId];
        continue;
      }
      renames.set(partId, to);
    }
    for (const [from, to] of renames) {
      const part = entry.parts[from];
      if (part === undefined) continue;
      delete entry.parts[from];
      entry.parts[to] = { ...part, id: to, messageID: incomingMessageId };
    }
    if (renames.size > 0 || entry.order.some((id) => !(id in entry.parts))) {
      // Dropped locals leave the order: filter and dedupe in one pass.
      entry.order = entry.order
        .map((id) => renames.get(id) ?? id)
        .filter((id, index, all) => id in entry.parts && all.indexOf(id) === index);
    }
    delete entry.infos[pendingId];
    pendingLocalMessages.delete(key);
    bucket[sessionId] = entry;
  });
}

/** Replaces one part with its full state (message.part.updated). */
export function applyPartDelta(serverId: string, sessionId: string, part: Part): void {
  updateServer(serverId, (bucket) => {
    putPart(bucket, sessionId, part);
  });
  // TASK-M2-08: a part for the echo may arrive before message.updated.
  maybeReconcileOnPart(serverId, sessionId, part.messageID, part);
}

export interface PartDelta {
  messageID: string;
  partID: string;
  field: string;
  delta: string;
}

/**
 * Applies a streaming delta (message.part.delta). "text"/"output" fields
 * append to the existing string (O(1) single-node update); any other field
 * replaces its value. When the delta arrives before the part, a text stub
 * is created so the UI can stream immediately; the later `part.updated`
 * replaces the stub with the full part state.
 */
export function applyTextDelta(serverId: string, sessionId: string, delta: PartDelta): void {
  if (typeof delta?.partID !== "string" || typeof delta.delta !== "string") return;
  updateServer(serverId, (bucket) => {
    const entry = bucket[sessionId] ?? freshSessionMessages();
    const existing = entry.parts[delta.partID];
    if (existing) {
      if (delta.field === "text") {
        const part = existing as Part & { text?: string };
        part.text = (part.text ?? "") + delta.delta;
      } else if (delta.field === "output") {
        const part = existing as Part & { output?: string };
        part.output = (part.output ?? "") + delta.delta;
      } else {
        (existing as unknown as Record<string, unknown>)[delta.field] = delta.delta;
      }
    } else {
      // Delta before part.updated: stub a text part so the stream renders.
      const stub: Part = {
        id: delta.partID,
        sessionID: sessionId,
        messageID: delta.messageID,
        type: "text",
        text: delta.field === "text" || delta.field === "output" ? delta.delta : "",
      };
      putPart(bucket, sessionId, stub);
      return;
    }
    bucket[sessionId] = entry;
  });
  // TASK-M2-08: a delta for the echo may arrive before message.updated.
  maybeReconcileOnPart(serverId, sessionId, delta.messageID);
}

/** Removes one part (message.part.removed). */
export function removePart(serverId: string, sessionId: string, partId: string): void {
  updateServer(serverId, (bucket) => {
    const entry = bucket[sessionId];
    if (!entry || !(partId in entry.parts)) return;
    delete entry.parts[partId];
    entry.order = entry.order.filter((id) => id !== partId);
    bucket[sessionId] = entry;
  });
}

/** Removes all parts of a message plus its info (message.removed). */
export function removePartsForMessage(
  serverId: string,
  sessionId: string,
  messageId: string,
): void {
  updateServer(serverId, (bucket) => {
    const entry = bucket[sessionId];
    if (!entry) return;
    for (const partId of [...entry.order]) {
      if (entry.parts[partId]?.messageID === messageId) {
        delete entry.parts[partId];
      }
    }
    entry.order = entry.order.filter((id) => id in entry.parts);
    if (entry.info?.id === messageId) entry.info = null;
    delete entry.infos[messageId];
    bucket[sessionId] = entry;
  });
}

/** Drops every message of one session (session.deleted cleanup). */
export function removeMessage(serverId: string, sessionId: string): void {
  pendingLocalMessages.delete(pendingKey(serverId, sessionId));
  updateServer(serverId, (bucket) => {
    delete bucket[sessionId];
  });
}

/** Clears all messages for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  const prefix = `${serverId}:`;
  for (const key of [...pendingLocalMessages.keys()]) {
    if (key.startsWith(prefix)) pendingLocalMessages.delete(key);
  }
  setMessages(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
