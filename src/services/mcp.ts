// MCP domain service (TASK-M9-06): typed wrappers around the MCP server
// family — GET /mcp (per-server status map), POST /mcp (add a local or
// remote server), POST /mcp/{name}/connect + /disconnect (connection
// control), the OAuth trio (POST /mcp/{name}/auth starts the flow and
// answers { authorizationUrl, oauthState }; POST /mcp/{name}/auth/callback
// submits an authorization code; POST /mcp/{name}/auth/authenticate starts
// the flow and waits for the callback; DELETE /mcp/{name}/auth removes the
// credentials). Verified against the 1.18.11 contract: the status map
// values are the MCPStatus union (connected | failed+error | disabled |
// needs_auth | needs_client_registration+error) and carry NO tools field,
// so the client cannot render a per-server tool count (the mcp.tools.changed
// event only carries the server name and triggers a list refresh); the add
// body is { name, config } with config being the McpLocalConfig
// (type:"local", command: string[]) or McpRemoteConfig (type:"remote",
// url) union. The auto OAuth poll mirrors the TASK-M5-07 provider pattern:
// POST /mcp/{name}/auth/authenticate with the mock `poll` query extension
// answers the current status immediately instead of blocking (documented
// in docs/api-coverage.md §5). Factory form per architecture §4.4. Errors
// pass through as ApiError from the client.

import type { components, operations } from "./api/schema.js";
import { type ApiClient, type ApiPath, type RequestOptions } from "./client.js";

export type McpStatus = components["schemas"]["MCPStatus"];
export type McpStatusConnected = components["schemas"]["MCPStatusConnected"];
export type McpStatusFailed = components["schemas"]["MCPStatusFailed"];
export type McpStatusDisabled = components["schemas"]["MCPStatusDisabled"];
export type McpStatusNeedsAuth = components["schemas"]["MCPStatusNeedsAuth"];
export type McpStatusNeedsClientRegistration =
  components["schemas"]["MCPStatusNeedsClientRegistration"];
export type McpLocalConfig = components["schemas"]["McpLocalConfig"];
export type McpRemoteConfig = components["schemas"]["McpRemoteConfig"];
/** Response of GET /mcp: per-server status map. */
export type McpStatusMap = NonNullable<
  operations["mcp.status"]["responses"][200]["content"]["application/json"]
>;
/** Body of POST /mcp: name + the local/remote config union. */
export type McpAddInput = { name: string; config: McpLocalConfig | McpRemoteConfig };
/** Response of POST /mcp/{name}/auth: the browser authorization URL. */
export type McpAuthStartResponse = NonNullable<
  operations["mcp.auth.start"]["responses"][200]["content"]["application/json"]
>;
/** Body of POST /mcp/{name}/auth/callback: the authorization code (the
 *  1.18.11 contract declares it inline, there is no named schema). */
export type McpAuthCallbackInput = { code: string };

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

function mcpPath(name: string): ApiPath {
  return `/mcp/${name}` as ApiPath;
}

export function createMcpService(client: ApiClient) {
  return {
    /** List every MCP server with its status (GET /mcp). */
    list: (dir?: string) => client.get<McpStatusMap>("/mcp", dirQuery(dir)),
    /**
     * Add a server (POST /mcp, body { name, config }): `local` configs run
     * a command line (command: string[] — the full command split into the
     * executable and its args), `remote` configs point at an SSE or streamable
     * HTTP URL. Resolves the full updated status map.
     */
    add: (input: McpAddInput, dir?: string) =>
      client.post<McpStatusMap>("/mcp", { ...dirQuery(dir), body: input }),
    /** Connect a server (POST /mcp/{name}/connect); resolves a boolean. */
    connect: (name: string, dir?: string) =>
      client.post<boolean>(`${mcpPath(name)}/connect` as ApiPath, dirQuery(dir)),
    /** Disconnect a server (POST /mcp/{name}/disconnect); resolves a boolean. */
    disconnect: (name: string, dir?: string) =>
      client.post<boolean>(`${mcpPath(name)}/disconnect` as ApiPath, dirQuery(dir)),
    /**
     * Start the OAuth flow (POST /mcp/{name}/auth): resolves the browser
     * authorization URL and the oauth state to correlate the callback.
     */
    authStart: (name: string, dir?: string) =>
      client.post<McpAuthStartResponse>(`${mcpPath(name)}/auth` as ApiPath, dirQuery(dir)),
    /** Remove a server's stored OAuth credentials (DELETE /mcp/{name}/auth). */
    authRemove: (name: string, dir?: string) =>
      client.delete<{ success: true }>(`${mcpPath(name)}/auth` as ApiPath, dirQuery(dir)),
    /** Submit an OAuth authorization code (POST /mcp/{name}/auth/callback);
     *  resolves the server's updated status. */
    authCallback: (name: string, code: string, dir?: string) =>
      client.post<McpStatus>(`${mcpPath(name)}/auth/callback` as ApiPath, {
        ...dirQuery(dir),
        body: { code } satisfies McpAuthCallbackInput,
      }),
    /**
     * Start the OAuth flow and wait for the callback (POST
     * /mcp/{name}/auth/authenticate — the 1.18.11 description says the real
     * server opens the browser and blocks until the callback completes).
     * Resolves the server's updated status.
     */
    authAuthenticate: (name: string, dir?: string) =>
      client.post<McpStatus>(`${mcpPath(name)}/auth/authenticate` as ApiPath, dirQuery(dir)),
    /**
     * Auto-flow status poll (TASK-M9-06): POST /mcp/{name}/auth/authenticate
     * with the mock `poll` query extension (the provider OAuth poll of
     * TASK-M5-07 in query form — authenticate has no request body per the
     * contract) answers the current status immediately instead of blocking:
     * `needs_auth` while the browser flow is pending, `connected` once the
     * callback completed. A real server ignores the unknown query parameter.
     */
    authPoll: (name: string, dir?: string) =>
      client.post<McpStatus>(`${mcpPath(name)}/auth/authenticate` as ApiPath, {
        ...dirQuery(dir),
        query: { poll: true },
      }),
  };
}

export type McpService = ReturnType<typeof createMcpService>;
