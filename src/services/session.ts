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
/** Request body of `POST /session/{id}/shell` (command + agent/model). */
export type ShellRunInput = NonNullable<
  operations["session.shell"]["requestBody"]
>["content"]["application/json"];
/** Response of `POST /session/{id}/shell` (the created assistant message). */
export type ShellRunResult =
  operations["session.shell"]["responses"]["200"]["content"]["application/json"];

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

function sessionPath(sessionID: string, suffix = ""): ApiPath {
  return `/session/${sessionID}${suffix}` as ApiPath;
}

export function createSessionService(client: ApiClient) {
  return {
    /** List all sessions, sorted by most recently updated. */
    list: (dir?: string) => client.get<Session[]>("/session", dirQuery(dir)),
    /** Create a new session (optionally forked from a parent). */
    create: (input: SessionCreateInput = {}) => client.post<Session>("/session", { body: input }),
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
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
