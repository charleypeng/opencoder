// Session create/rename/delete actions (TASK-M2-05): store mutations around
// the session REST endpoints. Create is not optimistic — the server assigns
// the id — it awaits the round-trip, then enters the store and becomes the
// active session. Rename and delete apply their change to the store
// immediately and restore the captured original when the server rejects.
// Errors surface as ApiError for the caller to display.

import { ApiError } from "../../services/errors";
import type { Session, SessionService } from "../../services/session";
import {
  getServerSessionState,
  removeSession,
  setActiveSession,
  upsertSession,
} from "../../stores/session";

/** Creates an empty session and opens it (upsert + set active). */
export async function createSession(
  serverId: string,
  sessionService: SessionService,
): Promise<Session> {
  try {
    const created = await sessionService.create({ title: undefined });
    upsertSession(serverId, created);
    setActiveSession(serverId, created.id);
    return created;
  } catch (err) {
    throw ApiError.fromUnknown(err);
  }
}

/** Forks a session (optionally from a message point) and opens the child. */
export async function forkSession(
  serverId: string,
  sessionId: string,
  messageID: string | undefined,
  sessionService: SessionService,
): Promise<Session> {
  try {
    const child = await sessionService.fork(sessionId, messageID);
    upsertSession(serverId, child);
    setActiveSession(serverId, child.id);
    return child;
  } catch (err) {
    throw ApiError.fromUnknown(err);
  }
}

/** Reverts the session to a message point; the server's updated session
 *  (carrying the `revert` marker) replaces the stored one. */
export async function revertSession(
  serverId: string,
  sessionId: string,
  messageID: string,
  sessionService: SessionService,
): Promise<Session> {
  try {
    const updated = await sessionService.revert(sessionId, messageID);
    upsertSession(serverId, updated);
    return updated;
  } catch (err) {
    throw ApiError.fromUnknown(err);
  }
}

/** Unreverts a session (one click); the server's updated session (revert
 *  marker cleared) replaces the stored one. */
export async function unrevertSession(
  serverId: string,
  sessionId: string,
  sessionService: SessionService,
): Promise<Session> {
  try {
    const updated = await sessionService.unrevert(sessionId);
    upsertSession(serverId, updated);
    return updated;
  } catch (err) {
    throw ApiError.fromUnknown(err);
  }
}

/** Shares a session; the server's updated session (carrying the `share`
 *  marker with the share URL) replaces the stored one. */
export async function shareSession(
  serverId: string,
  sessionId: string,
  sessionService: SessionService,
): Promise<Session> {
  try {
    const updated = await sessionService.share(sessionId);
    upsertSession(serverId, updated);
    return updated;
  } catch (err) {
    throw ApiError.fromUnknown(err);
  }
}

/** Unshares a session; the server's updated session (share marker cleared)
 *  replaces the stored one. */
export async function unshareSession(
  serverId: string,
  sessionId: string,
  sessionService: SessionService,
): Promise<Session> {
  try {
    const updated = await sessionService.unshare(sessionId);
    upsertSession(serverId, updated);
    return updated;
  } catch (err) {
    throw ApiError.fromUnknown(err);
  }
}

/** Renames a session; optimistic with rollback to the captured original. */
export async function renameSession(
  serverId: string,
  sessionId: string,
  title: string,
  sessionService: SessionService,
): Promise<void> {
  const original = requireSession(serverId, sessionId);
  upsertSession(serverId, { ...original, title });
  try {
    await sessionService.update(sessionId, { title });
  } catch (err) {
    upsertSession(serverId, original);
    throw ApiError.fromUnknown(err);
  }
}

/** Deletes a session; optimistic with rollback re-inserting the original. */
export async function deleteSession(
  serverId: string,
  sessionId: string,
  sessionService: SessionService,
): Promise<void> {
  const original = requireSession(serverId, sessionId);
  const wasActive = getServerSessionState(serverId).activeSessionId === sessionId;
  removeSession(serverId, sessionId);
  try {
    await sessionService.remove(sessionId);
  } catch (err) {
    upsertSession(serverId, original);
    if (wasActive) setActiveSession(serverId, sessionId);
    throw ApiError.fromUnknown(err);
  }
}

/** A session must be in the store for a mutation to make sense. */
function requireSession(serverId: string, sessionId: string): Session {
  const session = getServerSessionState(serverId).sessions[sessionId];
  if (session === undefined) {
    throw new ApiError(undefined, "unknown", `Session "${sessionId}" not found`, false);
  }
  return session;
}
