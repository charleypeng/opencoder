// PTY domain service (TASK-M6-01): typed wrappers around the PTY REST
// endpoints, factory form per architecture §4.4. Errors pass through as
// ApiError from the client (no catching here). The PTY data channel is NOT
// REST — it lives in src/services/ptyWs.ts (Rust WebSocket transport).

import type { components, operations } from "./api/schema.js";
import { type ApiClient, type ApiPath, type RequestOptions } from "./client.js";

export type Pty = components["schemas"]["Pty"];
/** One entry of `GET /pty/shells` (path/name/acceptable per the contract). */
export type PtyShell = NonNullable<
  operations["pty.shells"]["responses"]["200"]["content"]["application/json"]
>[number];
/** Request body of `POST /pty` (command/args/cwd/title/env, all optional). */
export type PtyCreateInput = NonNullable<
  operations["pty.create"]["requestBody"]
>["content"]["application/json"];
/** Request body of `PUT /pty/{id}` (title and/or size { rows, cols }). */
export type PtyUpdateInput = NonNullable<
  operations["pty.update"]["requestBody"]
>["content"]["application/json"];
/** Response of `POST /pty/{id}/connect-token` (ticket + expiry). */
export type PtyConnectToken = NonNullable<
  operations["pty.connectToken"]["responses"]["200"]["content"]["application/json"]
>;

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

function ptyPath(ptyID: string, suffix = ""): ApiPath {
  return `/pty/${ptyID}${suffix}` as ApiPath;
}

export function createPtyService(client: ApiClient) {
  return {
    /** List PTY sessions, optionally scoped to a directory. */
    list: (dir?: string) => client.get<Pty[]>("/pty", dirQuery(dir)),
    /** Create a PTY session (the WebSocket data channel opens on connect). */
    create: (input: PtyCreateInput = {}, dir?: string) =>
      client.post<Pty>("/pty", { body: input, ...(dirQuery(dir) ?? {}) }),
    /** Retrieve a PTY session's metadata. */
    get: (ptyID: string, dir?: string) => client.get<Pty>(ptyPath(ptyID), dirQuery(dir)),
    /** Update a PTY session (title and/or terminal size for resize). */
    update: (ptyID: string, input: PtyUpdateInput, dir?: string) =>
      client.put<Pty>(ptyPath(ptyID), { body: input, ...(dirQuery(dir) ?? {}) }),
    /** Remove a PTY session and kill its process. */
    remove: (ptyID: string, dir?: string) => client.delete<boolean>(ptyPath(ptyID), dirQuery(dir)),
    /** List the shells the server can launch terminals with. */
    shells: (dir?: string) => client.get<PtyShell[]>("/pty/shells", dirQuery(dir)),
    /**
     * Exchange a connect ticket (`{ ticket, expires_in }`) — the auth step
     * of the PTY WebSocket channel. The ws(s) URL assembly happens in Rust
     * (pty_ws_connect, TASK-M6-01 protocol verification).
     */
    connectToken: (ptyID: string, dir?: string) =>
      client.post<PtyConnectToken>(ptyPath(ptyID, "/connect-token"), dirQuery(dir)),
  };
}

export type PtyService = ReturnType<typeof createPtyService>;
