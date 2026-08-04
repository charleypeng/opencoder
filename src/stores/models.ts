// Model store (TASK-M5-05): per-server provider/model catalog from
// GET /provider plus the config default models (GET /config/providers,
// the authoritative source for the picker's Default marker) and the
// per-session active model choice. The catalog is a full-list replacement
// (setProviders); selections are recorded per session so switching
// sessions restores each session's model (the server has no per-session
// model PATCH, so the choice lives client-side). Resolving a session's
// model falls back from the recorded selection to the session's own model
// (when it is still in the catalog) to the config default and finally to
// the first model of the first connected provider.

import { createStore, produce } from "solid-js/store";
import { type Model, type Provider, type ProviderListResponse } from "../services/provider.js";

/** A model reference as used by prompt_async and the session schema. */
export interface ModelRef {
  providerID: string;
  modelID: string;
}

export interface ServerModelState {
  /** Full provider catalog from GET /provider (incl. unconnected). */
  providers: Provider[];
  /** Provider ids that are connected (have working credentials). */
  connected: string[];
  /**
   * Per-provider default model ids (providerID -> modelID) — from
   * GET /config/providers when available, else GET /provider's record.
   */
  defaultModels: Record<string, string>;
  /** The first entry of defaultModels (resolution-chain fallback). */
  defaultModel: ModelRef | null;
  /** A catalog was fetched successfully (fetch failures stay false). */
  loaded: boolean;
  /** Per-session model selection keyed by session id. */
  activeBySession: Record<string, ModelRef>;
}

export type ModelStateMap = Record<string, ServerModelState>;

export const EMPTY_SERVER_MODEL_STATE: ServerModelState = {
  providers: [],
  connected: [],
  defaultModels: {},
  defaultModel: null,
  loaded: false,
  activeBySession: {},
};

const [modelStates, setModelStates] = createStore<ModelStateMap>({});

/** Reactive per-server model state. */
export { modelStates };

/** Non-reactive read of one server's state bucket. */
export function getServerModelState(serverId: string): ServerModelState {
  return modelStates[serverId] ?? EMPTY_SERVER_MODEL_STATE;
}

/** All models of a provider (its models field is a record keyed by id). */
export function modelsOf(provider: Provider): Model[] {
  return Object.values(provider.models ?? {});
}

/** Looks a model up in the catalog by provider id + model id. */
export function findModel(state: ServerModelState, ref: ModelRef): Model | undefined {
  const provider = state.providers.find((p) => p.id === ref.providerID);
  return provider?.models[ref.modelID];
}

function firstDefaultRef(defaultModels: Record<string, string>): ModelRef | null {
  for (const [providerID, modelID] of Object.entries(defaultModels)) {
    return { providerID, modelID };
  }
  return null;
}

/**
 * Replaces the catalog from GET /provider (marks the server as loaded)
 * and seeds the default models from the response's default record.
 */
export function setProviders(serverId: string, response: ProviderListResponse): void {
  setModelStates(
    produce((draft) => {
      const state = draft[serverId] ?? { ...EMPTY_SERVER_MODEL_STATE, activeBySession: {} };
      state.providers = [...(response.all ?? [])];
      state.connected = [...(response.connected ?? [])];
      state.defaultModels = { ...(response.default ?? {}) };
      state.defaultModel = firstDefaultRef(state.defaultModels);
      state.loaded = true;
      draft[serverId] = state;
    }),
  );
}

/**
 * Updates the default models from GET /config/providers — the
 * authoritative source for the picker's Default marker (overrides the
 * record carried by GET /provider).
 */
export function setConfigDefault(serverId: string, defaultModels: Record<string, string>): void {
  setModelStates(
    produce((draft) => {
      const state = draft[serverId] ?? { ...EMPTY_SERVER_MODEL_STATE };
      state.defaultModels = { ...defaultModels };
      state.defaultModel = firstDefaultRef(state.defaultModels);
      draft[serverId] = state;
    }),
  );
}

/** Records the model choice for one session (persists per session). */
export function setModelForSession(serverId: string, sessionId: string, ref: ModelRef): void {
  setModelStates(
    produce((draft) => {
      const state = draft[serverId] ?? { ...EMPTY_SERVER_MODEL_STATE };
      state.activeBySession[sessionId] = { ...ref };
      draft[serverId] = state;
    }),
  );
}

/**
 * Resolves the effective model reference for a session: the recorded
 * selection first (dropped when the model vanished from the catalog),
 * then the session's own model when still in the catalog, then the
 * config default, then the first model of the first connected provider.
 * Null when the server exposes no usable model.
 */
export function activeModelFor(
  serverId: string,
  sessionId: string,
  sessionModel?: { id: string; providerID: string },
): ModelRef | null {
  const state = getServerModelState(serverId);
  const selected = state.activeBySession[sessionId];
  if (selected !== undefined && findModel(state, selected) !== undefined) {
    return selected;
  }
  if (sessionModel !== undefined) {
    const ref: ModelRef = { providerID: sessionModel.providerID, modelID: sessionModel.id };
    if (findModel(state, ref) !== undefined) {
      return ref;
    }
  }
  if (state.defaultModel !== null && findModel(state, state.defaultModel) !== undefined) {
    return state.defaultModel;
  }
  for (const provider of state.providers) {
    if (!state.connected.includes(provider.id)) continue;
    const first = modelsOf(provider)[0];
    if (first !== undefined) {
      return { providerID: provider.id, modelID: first.id };
    }
  }
  return null;
}

/** Clears all model state for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setModelStates(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
