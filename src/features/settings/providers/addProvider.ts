// Provider-add patch builder (TASK-S1-02): the Settings "Add provider"
// dialog registers dynamic providers through the Config PATCH family — the
// contract has no providers registry key, so a provider is added by
// merging `provider.<id>` (a ProviderConfig with an SDK package, endpoint,
// and at least one model) into the global or project config;
// enabled_providers/disabled_providers only gate enablement and are not
// touched here. This module owns that shape and the provider-id validation so
// the dialog and its L1 tests share one source of truth.

import type { ConfigPatch } from "../../../services/config.js";

/** Slug pattern of the contract's provider ids (providerID in model refs
 *  like "openai/gpt-5"): letters, digits, dashes and underscores. */
export const PROVIDER_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** True when the id is a valid provider id slug (empty ids fail). */
export function isValidProviderId(id: string): boolean {
  return PROVIDER_ID_RE.test(id);
}

/** The dialog's collected fields, as typed by the user (untrimmed). */
export interface AddProviderInput {
  /** Provider id — slug, required. */
  id: string;
  /** Optional display name. */
  name?: string;
  /** Optional base URL for OpenAI-compatible endpoints (options.baseURL). */
  baseURL?: string;
  /** Optional API key (options.apiKey). */
  apiKey?: string;
  /** AI SDK package used to implement the provider. */
  npm?: string;
  /** Model id exposed by the custom provider. */
  modelID: string;
  /** Optional display name for the model. */
  modelName?: string;
}

/** Builds the Config PATCH that registers a usable custom provider. OpenCode
 *  needs the provider implementation package and a model declaration before
 *  it can expose the provider through GET /provider and GET /models. */
export function buildProviderPatch(id: string, input: AddProviderInput): ConfigPatch {
  const name = input.name?.trim() ?? "";
  const baseURL = input.baseURL?.trim() ?? "";
  const apiKey = input.apiKey?.trim() ?? "";
  const npm = input.npm?.trim() || "@ai-sdk/openai-compatible";
  const modelID = input.modelID.trim();
  const modelName = input.modelName?.trim() || modelID;
  const config: {
    name?: string;
    npm: string;
    options?: { baseURL?: string; apiKey?: string };
    models: { [modelID: string]: { name: string } };
  } = { npm, models: { [modelID]: { name: modelName } } };
  if (name !== "") config.name = name;
  if (baseURL !== "" || apiKey !== "") {
    config.options = {};
    if (baseURL !== "") config.options.baseURL = baseURL;
    if (apiKey !== "") config.options.apiKey = apiKey;
  }
  return { provider: { [id.trim()]: config } };
}
