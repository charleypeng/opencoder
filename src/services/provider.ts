// Provider/Model domain service (TASK-M5-05/06): typed wrappers around
// GET /provider (the provider catalog with per-provider default model ids
// and the connected provider ids), GET /config/providers (the config
// catalog with the same default-model record, the authoritative source
// for the picker's Default marker), GET /provider/auth (the per-provider
// authentication methods driving the settings key forms) and the
// PUT/DELETE /auth/{providerID} credential endpoints (set / remove an API
// key; a server restart re-runs the auth probe, so the connected state is
// refreshed by re-listing). Factory form per architecture §4.4. Errors
// pass through as ApiError from the client (no catching here).

import type { components, operations } from "./api/schema.js";
import { type ApiClient, type ApiPath, type RequestOptions } from "./client.js";

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
/** How one provider can be authenticated (api key form / oauth flow). */
export type ProviderAuthMethod = components["schemas"]["ProviderAuthMethod"];
/** Response of GET /provider/auth: auth methods per provider id. */
export type ProviderAuthMethodsResponse = Record<string, ProviderAuthMethod[]>;
/** API-key credential body of PUT /auth/{providerID}. */
export type ApiAuth = components["schemas"]["ApiAuth"];

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

function authPath(providerID: string): ApiPath {
  return `/auth/${providerID}` as ApiPath;
}

export function createProviderService(client: ApiClient) {
  return {
    /** List all providers with their models, defaults and connected ids (GET /provider). */
    list: (dir?: string) => client.get<ProviderListResponse>("/provider", dirQuery(dir)),
    /** List configured providers and their default models (GET /config/providers). */
    configProviders: (dir?: string) =>
      client.get<ConfigProvidersResponse>("/config/providers", dirQuery(dir)),
    /** Auth methods per provider id (GET /provider/auth), driving the settings forms. */
    authMethods: (dir?: string) =>
      client.get<ProviderAuthMethodsResponse>("/provider/auth", dirQuery(dir)),
    /** Set an API key for a provider (PUT /auth/{providerID}, body { type: "api", key }). */
    setKey: (providerID: string, key: string, dir?: string) =>
      client.put<boolean>(authPath(providerID), {
        ...dirQuery(dir),
        body: { type: "api", key } satisfies ApiAuth,
      }),
    /** Remove a provider's stored API key (DELETE /auth/{providerID}). */
    removeKey: (providerID: string, dir?: string) =>
      client.delete<boolean>(authPath(providerID), dirQuery(dir)),
  };
}

export type ProviderService = ReturnType<typeof createProviderService>;
