// Messages store (TASK-M2-02): per-server normalized message/part tables
// fed by `message.*` and `message.part.*` SSE events. Parts are keyed by id
// with an explicit `order` array so streamed deltas update a single part in
// O(1) (no list scanning), while render order stays stable.
//
// `message.part.updated` carries the FULL part state and therefore replaces
// the stored part wholesale; `message.part.delta` appends to string fields
// ("text"/"output") and replaces anything else.

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
 * { info, parts } shape; the event schema itself has no parts).
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
}

/** Replaces one part with its full state (message.part.updated). */
export function applyPartDelta(serverId: string, sessionId: string, part: Part): void {
  updateServer(serverId, (bucket) => {
    putPart(bucket, sessionId, part);
  });
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
  updateServer(serverId, (bucket) => {
    delete bucket[sessionId];
  });
}

/** Clears all messages for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setMessages(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
