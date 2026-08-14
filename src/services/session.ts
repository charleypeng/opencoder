// Session domain service (TASK-M2-01): typed wrappers around the session
// REST endpoints, factory form per architecture §4.4. Errors pass through
// as ApiError from the client (no catching here).

import type { components, operations } from "./api/schema.js";
import { type ApiClient, type ApiPath, type RequestOptions } from "./client.js";

export type Session = components["schemas"]["Session"];
export type SessionStatus = components["schemas"]["SessionStatus"];
/** Request body of `POST /session` (parentID/title/agent/model/…). */
export type SessionCreateInput = NonNullable<
  operations["session.create"]["requestBody"]
>["content"]["application/json"];
/** Request body of `PATCH /session/{id}` (title/metadata/time.archived). */
export type SessionUpdateInput = NonNullable<
  operations["session.update"]["requestBody"]
>["content"]["application/json"];
/** Request body of `POST /session/{id}/prompt_async` (parts + options). */
export type PromptAsyncInput = NonNullable<
  operations["session.prompt_async"]["requestBody"]
>["content"]["application/json"];
/** Request body of `POST /session/{id}/message` (sync prompt, parts + options —
 *  the same shape as prompt_async, but the server waits for the full reply). */
export type PromptSyncInput = NonNullable<
  operations["session.prompt"]["requestBody"]
>["content"]["application/json"];
/** Response of `POST /session/{id}/message` (the created assistant message). */
export type PromptSyncResult =
  operations["session.prompt"]["responses"]["200"]["content"]["application/json"];
/** Request body of `POST /session/{id}/shell` (command + agent/model). */
export type ShellRunInput = NonNullable<
  operations["session.shell"]["requestBody"]
>["content"]["application/json"];
/** Response of `POST /session/{id}/shell` (the created assistant message). */
export type ShellRunResult =
  operations["session.shell"]["responses"]["200"]["content"]["application/json"];
/** Request body of `POST /session/{id}/fork` (optional fork-point message). */
export type SessionForkInput = NonNullable<
  operations["session.fork"]["requestBody"]
>["content"]["application/json"];
/** Request body of `POST /session/{id}/revert` ({ messageID, partID? }). */
export type SessionRevertInput = NonNullable<
  operations["session.revert"]["requestBody"]
>["content"]["application/json"];
/** Request body of `POST /session/{id}/summarize` (provider/model + auto). */
export type SessionSummarizeInput = NonNullable<
  operations["session.summarize"]["requestBody"]
>["content"]["application/json"];
/** Request body of `POST /session/{id}/init` (provider/model + messageID). */
export type SessionInitInput = NonNullable<
  operations["session.init"]["requestBody"]
>["content"]["application/json"];

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

function sessionPath(sessionID: string, suffix = ""): ApiPath {
  return `/session/${sessionID}${suffix}` as ApiPath;
}

export function createSessionService(client: ApiClient) {
  // Internal shared implementation so `listRoots` does not re-create the
  // service (list is referenced by both public methods below).
  const list = (dir?: string, roots?: boolean) =>
    client.get<Session[]>("/session", {
      query: {
        ...(dir === undefined ? {} : { directory: dir }),
        ...(roots === undefined ? {} : { roots }),
      },
      // A roots listing must span EVERY opened directory (the workspace
      // tree), so the global active-directory injection is skipped — with
      // it the server would narrow the listing to the current folder and
      // the other workspaces' sessions would vanish from the tree (Bug 2).
      ...(roots === true ? { skipDirectory: true } : {}),
    });
  return {
    /**
     * List all sessions, sorted by most recently updated. When `roots` is
     * true the server returns only top-level sessions (no subagent children,
     * parentID unset) — the sidebar workspace tree lists roots only, and the
     * per-session children come from GET /session/{id}/children.
     */
    list,
    /** List only top-level (root) sessions, across every opened directory. */
    listRoots: (dir?: string) => list(dir, true),
    /** Create a new session, optionally in a specific project directory
     *  (POST /session?directory=; the filepicker dialog passes it). */
    create: (input: SessionCreateInput = {}, dir?: string) =>
      client.post<Session>("/session", { body: input, ...dirQuery(dir) }),
    /** Retrieve detailed information about a specific session. */
    get: (sessionID: string, dir?: string) =>
      client.get<Session>(sessionPath(sessionID), dirQuery(dir)),
    /** Update session properties such as title or archived time. */
    update: (sessionID: string, patch: SessionUpdateInput) =>
      client.patch<Session>(sessionPath(sessionID), { body: patch }),
    /** Delete a session and all of its messages. */
    remove: (sessionID: string) => client.delete<boolean>(sessionPath(sessionID)),
    /** Current status of all sessions (idle/busy/retry), keyed by session id. */
    statusAll: (dir?: string) =>
      client.get<Record<string, SessionStatus>>("/session/status", dirQuery(dir)),
    /** Send a message asynchronously; the streamed reply arrives via SSE. */
    promptAsync: (sessionID: string, body: PromptAsyncInput) =>
      client.post<void>(sessionPath(sessionID, "/prompt_async"), { body }),
    /**
     * Send a message synchronously (POST /session/{id}/message): the body
     * matches prompt_async, but the endpoint waits for the full reply and
     * resolves the created assistant message ({ info, parts }) directly —
     * for simple one-shot calls that do not need SSE streaming.
     */
    sendSync: (sessionID: string, body: PromptSyncInput, dir?: string) =>
      client.post<PromptSyncResult>(sessionPath(sessionID, "/message"), {
        body: body satisfies PromptSyncInput,
        ...(dirQuery(dir) ?? {}),
      }),
    /** List the direct child sessions of a session (GET /session/{id}/
     *  children); the response is an array of full Session objects. */
    children: (sessionID: string, dir?: string) =>
      client.get<Session[]>(sessionPath(sessionID, "/children"), dirQuery(dir)),
    /** Abort an active session and stop any ongoing processing. */
    abort: (sessionID: string) => client.post<boolean>(sessionPath(sessionID, "/abort")),
    /**
     * Execute a shell command in the session (POST /session/{id}/shell);
     * resolves the created assistant message ({ info, parts }) directly —
     * the endpoint is synchronous, unlike prompt_async. The contract
     * requires `agent`; `command` is the text after the `!` prefix.
     */
    shell: (sessionID: string, input: ShellRunInput, dir?: string) =>
      client.post<ShellRunResult>(sessionPath(sessionID, "/shell"), {
        body: input satisfies ShellRunInput,
        ...(dirQuery(dir) ?? {}),
      }),
    /**
     * Fork the session — optionally from a message point (POST
     * /session/{id}/fork). Resolves the created child session, whose
     * parentID points back at the forked session. The body is empty when
     * no messageID is given.
     */
    fork: (sessionID: string, messageID?: string, dir?: string) =>
      client.post<Session>(sessionPath(sessionID, "/fork"), {
        body: (messageID === undefined ? {} : { messageID }) satisfies SessionForkInput,
        ...(dirQuery(dir) ?? {}),
      }),
    /**
     * Revert a specific message in a session (POST /session/{id}/revert):
     * the server rolls back the file changes made after it. Resolves the
     * updated session, whose `revert` field carries the revert point.
     */
    revert: (sessionID: string, messageID: string, dir?: string) =>
      client.post<Session>(sessionPath(sessionID, "/revert"), {
        body: { messageID } satisfies SessionRevertInput,
        ...(dirQuery(dir) ?? {}),
      }),
    /**
     * Restore all previously reverted messages in a session (POST
     * /session/{id}/unrevert, no body). Resolves the updated session with
     * the `revert` marker cleared.
     */
    unrevert: (sessionID: string, dir?: string) =>
      client.post<Session>(sessionPath(sessionID, "/unrevert"), {
        ...(dirQuery(dir) ?? {}),
      }),
    /**
     * Create a shareable link for a session (POST /session/{id}/share, no
     * body per the contract). Resolves the updated session carrying
     * `share: { url }`; unshare clears the marker the same way.
     */
    share: (sessionID: string, dir?: string) =>
      client.post<Session>(sessionPath(sessionID, "/share"), dirQuery(dir)),
    /**
     * Remove the shareable link, making the session private again (DELETE
     * /session/{id}/share). Resolves the updated session without the
     * `share` field.
     */
    unshare: (sessionID: string, dir?: string) =>
      client.delete<Session>(sessionPath(sessionID, "/share"), dirQuery(dir)),
    /**
     * Summarize (compact) the session's context (POST /session/{id}/
     * summarize). The body carries the provider/model pair the server
     * summarizes with, plus the optional `auto` flag; the response is a
     * plain success boolean (the compacted context arrives as the
     * session's `summary` via SSE/parts, not in this response).
     */
    summarize: (sessionID: string, body: SessionSummarizeInput, dir?: string) =>
      client.post<boolean>(sessionPath(sessionID, "/summarize"), {
        body: body satisfies SessionSummarizeInput,
        ...(dirQuery(dir) ?? {}),
      }),
    /**
     * Generate an AGENTS.md for the project (POST /session/{id}/init).
     * The contract requires the provider/model pair AND the messageID of
     * the analysis request the file is generated from; the response is a
     * plain success boolean.
     */
    init: (sessionID: string, body: SessionInitInput, dir?: string) =>
      client.post<boolean>(sessionPath(sessionID, "/init"), {
        body: body satisfies SessionInitInput,
        ...(dirQuery(dir) ?? {}),
      }),
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
