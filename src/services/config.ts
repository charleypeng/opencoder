// Config domain service (TASK-M9-05): typed wrapper around GET/PATCH
// /config (project-level), GET/PATCH /global/config and POST
// /instance/dispose. Verified against the 1.18.11 contract: the Config
// schema is a flat object of 36 known keys (model / default_agent /
// share / autoupdate / permission / logLevel / …) with
// additionalProperties: false — there is NO `theme` key (theme is a
// client-side preference, TASK-M9-03), and the PATCH body is the Config
// schema itself: the server treats it as a deep partial and merges it
// into the stored config (nested plain objects merge, arrays/scalars
// replace), answering the FULL updated Config. Factory form per
// architecture §4.4. Errors pass through as ApiError from the client.

import type { components } from "./api/schema.js";
import { type ApiClient, type RequestOptions } from "./client.js";

/** The server-side config object (Config schema of the 1.18.11 contract). */
export type Config = components["schemas"]["Config"];

/** Recursive partial of the config: any subset of keys, nested objects
 *  may be partial too — exactly what PATCH /config merges in. */
export type ConfigPatch = {
  [K in keyof Config]?: Config[K] extends Record<string, unknown>
    ? ConfigPatchValue<Config[K]>
    : Config[K];
};

type ConfigPatchValue<T> = T extends Record<string, unknown> ? { [K in keyof T]?: T[K] } : T;

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

export function createConfigService(client: ApiClient) {
  return {
    /** Read the project-level config (GET /config). */
    get: (dir?: string) => client.get<Config>("/config", dirQuery(dir)),
    /** Merge a partial config into the project-level config (PATCH
     *  /config); resolves the full updated config. */
    update: (patch: ConfigPatch, dir?: string) =>
      client.patch<Config>("/config", { ...dirQuery(dir), body: patch }),
    /** Read the global config (GET /global/config). */
    getGlobal: () => client.get<Config>("/global/config"),
    /** Merge a partial config into the global config (PATCH
     *  /global/config); resolves the full updated config. */
    updateGlobal: (patch: ConfigPatch) => client.patch<Config>("/global/config", { body: patch }),
    /** Dispose the connected server instance (POST /instance/dispose);
     *  the server shuts down and the connection drops. */
    dispose: (dir?: string) => client.post<boolean>("/instance/dispose", dirQuery(dir)),
  };
}

export type ConfigService = ReturnType<typeof createConfigService>;
