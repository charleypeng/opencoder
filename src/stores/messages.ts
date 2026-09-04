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
// reconcilePendingDraft, called from upsertMessageDraft and from the
// part-first paths). An echo that already carries its own text replaces the
// optimistic message entirely; a non-user message leaves both the marker and
// the local message pending until the real echo arrives. A prompt the server
// never echoes keeps its optimistic bubble and marker until the next send
// replaces it — same as a silent server.
//
// TASK-M2-09 streaming rendering support:
// - `messageParts` (messageID -> ordered part ids) is the render grouping
//   structure. It is REPLACED wholesale (new object identity) only when part
//   membership changes, so a component memo keyed on it re-runs on new/removed
//   parts but NOT on text deltas — the per-part granularity that keeps a
//   1000-part transcript at 60fps.
// - `lastDeltaAt` is bumped by every part mutation; the UI derives its
//   "streaming" indicator from it (busy + recent delta).
// - `applyMessageBatch` applies a history payload in ONE produce pass instead
//   of one produce per message/part (history fetch on session open).
//
// All mutations run through draft-level helpers (putPartDraft, ...) so the
// single-item API and applyMessageBatch share the exact same semantics; the
// helpers operate on the produce draft bucket and may be called any number of
// times inside one updateServer pass.

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
  /** Part ids grouped by message id, in first-appearance order (M2-09). */
  messageParts: Record<string, string[]>;
  /** Epoch ms of the last part mutation; 0 until the first one (M2-09). */
  lastDeltaAt: number;
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
  return { info: null, infos: {}, parts: {}, order: [], messageParts: {}, lastDeltaAt: 0 };
}

// Pending optimistic local message ids per (server, session), registered by
// PromptBox on send and consumed by the first real server message after it.
function pendingKey(serverId: string, sessionId: string): string {
  return `${serverId}:${sessionId}`;
}

const pendingLocalMessages = new Map<string, string>();

// Renamed optimistic part ids per (server, session) — the echo message id
// they were migrated under. Real servers stream the user echo's own
// `message.part.updated` right after the `message.updated` envelope; when
// that real part lands the renamed locals must be dropped so the prompt
// text does not render twice (TASK-M2-08 follow-up, real-server parity).
const renamedEchoParts = new Map<string, { echoId: string; partIds: string[] }>();

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

/** True while an optimistic user message still awaits its server echo. */
export function hasPendingLocalMessage(serverId: string, sessionId: string): boolean {
  return pendingLocalMessages.has(pendingKey(serverId, sessionId));
}

/** Drops a session's pending marker (rollback, session switch, unmount). */
export function untrackPendingLocalMessage(serverId: string, sessionId: string): void {
  const key = pendingKey(serverId, sessionId);
  pendingLocalMessages.delete(key);
  renamedEchoParts.delete(key);
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

/**
 * Rebuilds `messageParts` from the current order/parts tables. Used after
 * structural mutations that cannot be expressed as single-map edits
 * (reconciliation); ordinary insert/remove paths edit the map directly.
 */
function rebuildMessageParts(entry: SessionMessages): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of entry.order) {
    const part = entry.parts[id];
    if (part === undefined) continue;
    (out[part.messageID] ??= []).push(id);
  }
  return out;
}

/** Cheap structural equality for the messageParts map (key sets + arrays). */
function messagePartsEqual(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const va = a[key];
    const vb = b[key];
    if (vb === undefined || va.length !== vb.length) return false;
    for (let i = 0; i < va.length; i++) {
      if (va[i] !== vb[i]) return false;
    }
  }
  return true;
}

/**
 * Replaces `messageParts` after a structural mutation. The assignment is
 * skipped when the rebuilt map matches the current one so the grouping memo
 * (which subscribes to the map node) is not fired needlessly.
 */
function syncMessageParts(entry: SessionMessages): void {
  const rebuilt = rebuildMessageParts(entry);
  if (!messagePartsEqual(rebuilt, entry.messageParts)) {
    entry.messageParts = rebuilt;
  }
}

/**
 * Inserts a part into the normalized table, appending to order when new.
 * A new part id also updates `messageParts` (replacing the map wholesale, so
 * grouping subscribers fire once) and bumps `lastDeltaAt`.
 *
 * `overwrite` (default true) controls whether an EXISTING part is replaced:
 * live `message.part.updated` events always overwrite (the server says this
 * is the full current state), but history-page batches pass false — a part
 * already in the store (streamed via SSE) must not be clobbered by an older
 * server snapshot, which would truncate text the client already accumulated
 * (the thinking-content "sometimes full, sometimes not" bug: the page's
 * shorter reasoning snapshot replaced the streamed deltas).
 *
 * TASK-M3-05 prepend: an older history page lands in FRONT of the already
 * loaded transcript — new part ids unshift the order and the message group
 * is inserted at the head of the grouping map, so render order always
 * matches server history.
 */
function putPartDraft(
  bucket: Record<string, SessionMessages>,
  sessionId: string,
  part: Part,
  prepend = false,
  overwrite = true,
): void {
  if (typeof part?.id !== "string") return;
  const entry = bucket[sessionId] ?? freshSessionMessages();
  const isNew = !(part.id in entry.parts);
  if (isNew) {
    if (prepend) {
      entry.order.unshift(part.id);
      const ids = entry.messageParts[part.messageID] ?? [];
      entry.messageParts = { [part.messageID]: [part.id, ...ids], ...entry.messageParts };
    } else {
      entry.order.push(part.id);
      const ids = entry.messageParts[part.messageID] ?? [];
      entry.messageParts = { ...entry.messageParts, [part.messageID]: [...ids, part.id] };
    }
  }
  if (overwrite || isNew) {
    entry.parts[part.id] = part;
    entry.lastDeltaAt = Date.now();
  }
  bucket[sessionId] = entry;
}

/**
 * Upserts a message (message.updated): replaces the info (both the
 * most-recent slot and the per-message table) and normalizes any parts
 * carried on the info payload (recorded session messages use a
 * { info, parts } shape; the event schema itself has no parts), then runs
 * the pending-message reconciliation (TASK-M2-08, see reconcilePendingDraft).
 *
 * `overwriteParts` (default true) applies to carried parts only: live
 * message events always overwrite; history batches pass false so an
 * existing streamed part (with more text) is never clobbered by the page's
 * snapshot (see putPartDraft).
 *
 * TASK-M3-05 prepend: an older history page keeps its metadata in `infos`
 * but must NOT overwrite the most-recent info slot with an older message.
 */
function upsertMessageDraft(
  bucket: Record<string, SessionMessages>,
  sessionId: string,
  key: string,
  info: Message,
  opts: { prepend?: boolean; overwriteParts?: boolean } = {},
): void {
  const entry = bucket[sessionId] ?? freshSessionMessages();
  if (!opts.prepend) entry.info = info;
  entry.infos[info.id] = info;
  bucket[sessionId] = entry;
  const carried = (info as Message & { parts?: unknown }).parts;
  if (Array.isArray(carried)) {
    for (const part of carried) {
      putPartDraft(bucket, sessionId, part as Part, opts.prepend, opts.overwriteParts ?? true);
    }
  }
  reconcilePendingDraft(bucket, sessionId, key, info.id, info.role, carried as Part[] | undefined);
}

/** Draft-level wrapper (TASK-M2-09 batching shares this exact path). */
export function upsertMessage(serverId: string, sessionId: string, info: Message): void {
  updateServer(serverId, (bucket) => {
    upsertMessageDraft(bucket, sessionId, pendingKey(serverId, sessionId), info);
  });
}

/**
 * Part-first reconciliation hook (TASK-M2-08): message.part.updated and
 * message.part.delta for the echo can arrive before message.updated. When a
 * part for a server message lands while the session's marker is pending and
 * the local parts still exist, the same reconcile-if-safe logic runs.
 *
 * Real-server parity: when a metadata-only echo was reconciled by renaming
 * the local parts under `prt-{echoId}` and the server then streams its OWN
 * part for that echo (`message.part.updated`, id NOT in the renamed set),
 * the renamed locals are dropped — keeping the prompt text exactly once.
 * Draft variant: reads the in-progress bucket so batching sees the items
 * applied earlier in the same pass.
 */
function maybeReconcileOnPartDraft(
  bucket: Record<string, SessionMessages>,
  sessionId: string,
  key: string,
  messageId: string,
  part?: Part,
): void {
  if (typeof messageId !== "string") return;
  const entry = bucket[sessionId];
  if (entry === undefined) return;
  // Real part of a renamed echo: drop the renamed locals (one render).
  const renamed = renamedEchoParts.get(key);
  if (renamed !== undefined && renamed.echoId === messageId) {
    const isRenamedLocal = part !== undefined && renamed.partIds.includes(part.id);
    if (!isRenamedLocal) {
      for (const partId of renamed.partIds) {
        if (partId in entry.parts) delete entry.parts[partId];
      }
      entry.order = entry.order.filter((id) => id in entry.parts);
      syncMessageParts(entry);
      renamedEchoParts.delete(key);
      bucket[sessionId] = entry;
    }
    return;
  }
  const pendingId = pendingLocalMessages.get(key);
  if (pendingId === undefined || pendingId === messageId) return;
  if (!entry.order.some((id) => entry.parts[id]?.messageID === pendingId)) return;
  reconcilePendingDraft(
    bucket,
    sessionId,
    key,
    messageId,
    undefined,
    part === undefined ? undefined : [part],
  );
}

/**
 * Reconciles the pending optimistic local message against the incoming
 * server message (TASK-M2-08), called from upsertMessageDraft and, via
 * maybeReconcileOnPartDraft, from the part-first paths. Idempotent: the
 * marker is cleared once a reconciliation applies, so later messages upsert
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
function reconcilePendingDraft(
  bucket: Record<string, SessionMessages>,
  sessionId: string,
  key: string,
  incomingMessageId: string,
  incomingRole: string | undefined,
  incomingParts: Part[] | undefined,
): void {
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
    syncMessageParts(entry);
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
      renames.size === 0 ? `prt-${incomingMessageId}` : `prt-${incomingMessageId}-${renames.size}`;
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
  syncMessageParts(entry);
  delete entry.infos[pendingId];
  pendingLocalMessages.delete(key);
  // Real servers stream the user echo's own part right after the envelope;
  // remember the renamed ids so that real part can drop them (one render).
  if (renames.size > 0) {
    renamedEchoParts.set(key, { echoId: incomingMessageId, partIds: [...renames.values()] });
  }
  bucket[sessionId] = entry;
}

/**
 * Replaces one part with its full state (message.part.updated) and bumps
 * the streaming timestamp.
 */
function applyPartDeltaDraft(
  bucket: Record<string, SessionMessages>,
  sessionId: string,
  key: string,
  part: Part,
  prepend = false,
  overwrite = true,
): void {
  putPartDraft(bucket, sessionId, part, prepend, overwrite);
  maybeReconcileOnPartDraft(bucket, sessionId, key, part.messageID, part);
}

/** Draft-level wrapper (TASK-M2-09 batching shares this exact path). */
export function applyPartDelta(serverId: string, sessionId: string, part: Part): void {
  updateServer(serverId, (bucket) => {
    applyPartDeltaDraft(bucket, sessionId, pendingKey(serverId, sessionId), part);
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
 * replaces the stub with the full part state. Every application bumps
 * `lastDeltaAt` (the streaming indicator).
 */
function applyTextDeltaDraft(
  bucket: Record<string, SessionMessages>,
  sessionId: string,
  delta: PartDelta,
): void {
  if (typeof delta?.partID !== "string" || typeof delta.delta !== "string") return;
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
    entry.lastDeltaAt = Date.now();
  } else {
    // Delta before part.updated: stub a text part so the stream renders.
    const stub: Part = {
      id: delta.partID,
      sessionID: sessionId,
      messageID: delta.messageID,
      type: "text",
      text: delta.field === "text" || delta.field === "output" ? delta.delta : "",
    };
    putPartDraft(bucket, sessionId, stub);
    return;
  }
  bucket[sessionId] = entry;
}

/** Draft-level wrapper (TASK-M2-09 batching shares this exact path). */
export function applyTextDelta(serverId: string, sessionId: string, delta: PartDelta): void {
  // Malformed deltas are dropped wholesale (no stub, no reconciliation).
  if (typeof delta?.partID !== "string" || typeof delta.delta !== "string") return;
  const key = pendingKey(serverId, sessionId);
  updateServer(serverId, (bucket) => {
    applyTextDeltaDraft(bucket, sessionId, delta);
    maybeReconcileOnPartDraft(bucket, sessionId, key, delta.messageID);
  });
}

/**
 * Batch mutation (TASK-M2-09): applies a history payload (messages with
 * their parts) in a SINGLE produce pass instead of one setMessages per item.
 * Item order is preserved; reconciliation semantics are identical to the
 * single-item API (each item is applied as if it were the only one, in
 * sequence). Used by MessageList's history fetch.
 *
 * TASK-M3-05: with `{ prepend: true }` the items land in FRONT of the loaded
 * history (an older page) instead of at the end, and the most-recent info
 * slot is left untouched.
 */
export type MessageBatchItem =
  | { type: "message"; info: Message }
  | { type: "part"; part: Part }
  | { type: "delta"; delta: PartDelta };

export interface MessageBatchOptions {
  /** Insert the batch in front of the existing history (TASK-M3-05). */
  prepend?: boolean;
}

export function applyMessageBatch(
  serverId: string,
  sessionId: string,
  items: MessageBatchItem[],
  options: MessageBatchOptions = {},
): void {
  if (items.length === 0) return;
  const key = pendingKey(serverId, sessionId);
  updateServer(serverId, (bucket) => {
    // TASK-M3-05: a prepend inserts each new item at the HEAD, so applying
    // the page in reverse keeps the page's internal order (chronological
    // oldest first) intact once every item has landed.
    const ordered = options.prepend ? [...items].reverse() : items;
    for (const item of ordered) {
      switch (item.type) {
        case "message":
          // History pages must not clobber parts already streamed into the
          // store: a page snapshot can be SHORTER than the accumulated
          // deltas (e.g. a reasoning part captured mid-generation), and
          // overwriting would truncate the thinking text.
          upsertMessageDraft(bucket, sessionId, key, item.info, {
            ...options,
            overwriteParts: false,
          });
          break;
        case "part":
          applyPartDeltaDraft(bucket, sessionId, key, item.part, options.prepend, false);
          break;
        case "delta":
          if (typeof item.delta?.partID !== "string" || typeof item.delta.delta !== "string") {
            break;
          }
          applyTextDeltaDraft(bucket, sessionId, item.delta);
          maybeReconcileOnPartDraft(bucket, sessionId, key, item.delta.messageID);
          break;
      }
    }
  });
}

/** Removes one part (message.part.removed). */
export function removePart(serverId: string, sessionId: string, partId: string): void {
  updateServer(serverId, (bucket) => {
    const entry = bucket[sessionId];
    if (!entry || !(partId in entry.parts)) return;
    const messageID = entry.parts[partId].messageID;
    delete entry.parts[partId];
    entry.order = entry.order.filter((id) => id !== partId);
    const ids = entry.messageParts[messageID];
    if (ids !== undefined) {
      const next = ids.filter((id) => id !== partId);
      const rest = { ...entry.messageParts };
      if (next.length === 0) delete rest[messageID];
      else rest[messageID] = next;
      entry.messageParts = rest;
    }
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
    const rest = { ...entry.messageParts };
    delete rest[messageId];
    entry.messageParts = rest;
    if (entry.info?.id === messageId) entry.info = null;
    delete entry.infos[messageId];
    bucket[sessionId] = entry;
  });
}

/** Drops every message of one session (session.deleted cleanup). */
export function removeMessage(serverId: string, sessionId: string): void {
  const key = pendingKey(serverId, sessionId);
  pendingLocalMessages.delete(key);
  renamedEchoParts.delete(key);
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
  for (const key of [...renamedEchoParts.keys()]) {
    if (key.startsWith(prefix)) renamedEchoParts.delete(key);
  }
  setMessages(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
