// Agent domain service (TASK-M5-04): typed wrapper around GET /agent (the
// agents the server exposes — name/description/mode/color/hidden etc.).
// Factory form per architecture §4.4. Errors pass through as ApiError from
// the client (no catching here).

import type { components } from "./api/schema.js";
import { type ApiClient, type RequestOptions } from "./client.js";

export type Agent = components["schemas"]["Agent"];

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

export function createAgentService(client: ApiClient) {
  return {
    /** List all agents the server exposes (GET /agent). */
    list: (dir?: string) => client.get<Agent[]>("/agent", dirQuery(dir)),
  };
}

export type AgentService = ReturnType<typeof createAgentService>;
