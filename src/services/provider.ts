// Provider/Model domain service (TASK-M5-05): typed wrappers around
// GET /provider (the provider catalog with per-provider default model ids
// and the connected provider ids) and GET /config/providers (the config
// catalog with the same default-model record, the authoritative source
// for the picker's Default marker). Factory form per architecture §4.4.
// Errors pass through as ApiError from the client (no catching here).

import type { components, operations } from "./api/schema.js";
import { type ApiClient, type RequestOptions } from "./client.js";

export type Provider = components["schemas"]["Provider"];
export type Model = components["schemas"]["Model"];
/** Response of GET /provider: catalog + per-provider default models + connected ids. */
export type ProviderListResponse = NonNullable<
  operations["provider.list"]["responses"][200]["content"]["application/json"]
>;
/** Response of GET /config/providers: config catalog + default models. */
export type ConfigProvidersResponse = NonNullable<
  operations["config.providers"]["responses"][200]["content"]["application/json"]
>;

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

export function createProviderService(client: ApiClient) {
  return {
    /** List all providers with their models, defaults and connected ids (GET /provider). */
    list: (dir?: string) => client.get<ProviderListResponse>("/provider", dirQuery(dir)),
    /** List configured providers and their default models (GET /config/providers). */
    configProviders: (dir?: string) =>
      client.get<ConfigProvidersResponse>("/config/providers", dirQuery(dir)),
  };
}

export type ProviderService = ReturnType<typeof createProviderService>;
