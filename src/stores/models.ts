// Model store (TASK-M5-05): per-server provider/model catalog from
// GET /provider plus the config default models (GET /config/providers,
// the authoritative source for the picker's Default marker) and the
// per-session active model choice. The catalog is a full-list replacement
// (setProviders); selections are recorded per session so switching
// sessions restores each session's model (the server has no per-session
// model PATCH, so the choice lives client-side). Resolving a session's
// model falls back from the recorded selection to the session's own model
// (when it is still in the catalog) to the client-side per-server default
// (TASK-S1-01, the Settings pick persisted in localStorage) to the config
// default and finally to the first model of the first connected provider;
// each preselection is additionally gated on the provider being connected,
// so a disconnected provider never preselects (TASK-M6-06).

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
  /**
   * The client-side per-server default model picked in Settings
   * (TASK-S1-01), persisted under `oc-default-model:{serverId}` and
   * hydrated from localStorage whenever the catalog loads. It sits
   * ABOVE the config default and BELOW a session's explicit selection.
   */
  localDefault: ModelRef | null;
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
  localDefault: null,
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

/** True when the ref is still in the catalog AND its provider is connected
 *  (preselections must stay within connected providers: a disconnected one
 *  would leave the compact select with an unmatchable value; the settings
 *  section gates its local-default display on the same rule so the UI
 *  never shows a default that sessions cannot resolve to). */
export function usable(state: ServerModelState, ref: ModelRef): boolean {
  return state.connected.includes(ref.providerID) && findModel(state, ref) !== undefined;
}

function firstDefaultRef(defaultModels: Record<string, string>): ModelRef | null {
  for (const [providerID, modelID] of Object.entries(defaultModels)) {
    return { providerID, modelID };
  }
  return null;
}

/** localStorage key prefix for the per-server default model choice. */
export const DEFAULT_MODEL_STORAGE_PREFIX = "oc-default-model:";

/** Reads the persisted per-server default model; tolerant of bad data. */
export function loadLocalDefault(serverId: string): ModelRef | null {
  try {
    const raw = window.localStorage.getItem(DEFAULT_MODEL_STORAGE_PREFIX + serverId);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const ref = parsed as Partial<ModelRef>;
    if (typeof ref.providerID !== "string" || typeof ref.modelID !== "string") return null;
    return { providerID: ref.providerID, modelID: ref.modelID };
  } catch {
    return null;
  }
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
      state.localDefault = loadLocalDefault(serverId);
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
      state.localDefault = loadLocalDefault(serverId);
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
 * Sets (or clears, with a null ref) the client-side per-server default
 * model (TASK-S1-01): the slot feeds the resolution chain above the
 * config default, and the choice persists per server so it survives
 * restarts. A null ref removes the stored key.
 */
export function setLocalDefault(serverId: string, ref: ModelRef | null): void {
  const slot = ref === null ? null : { ...ref };
  setModelStates(
    produce((draft) => {
      const state = draft[serverId] ?? { ...EMPTY_SERVER_MODEL_STATE };
      state.localDefault = slot;
      draft[serverId] = state;
    }),
  );
  try {
    if (ref === null) {
      window.localStorage.removeItem(DEFAULT_MODEL_STORAGE_PREFIX + serverId);
    } else {
      window.localStorage.setItem(DEFAULT_MODEL_STORAGE_PREFIX + serverId, JSON.stringify(ref));
    }
  } catch {
    // Storage unavailable (private mode / quota): the choice stays in-memory.
  }
}

/**
 * Resolves the effective model reference for a session: the recorded
 * selection first, then the session's own model, then the client-side
 * per-server default (TASK-S1-01), then the config default — each dropped
 * when it left the catalog OR its provider is disconnected — then the
 * first model of the first connected provider. Null when the server
 * exposes no usable model.
 */
export function activeModelFor(
  serverId: string,
  sessionId: string,
  sessionModel?: { id: string; providerID: string },
): ModelRef | null {
  const state = getServerModelState(serverId);
  const selected = state.activeBySession[sessionId];
  if (selected !== undefined && usable(state, selected)) {
    return selected;
  }
  if (sessionModel !== undefined) {
    const ref: ModelRef = { providerID: sessionModel.providerID, modelID: sessionModel.id };
    if (usable(state, ref)) {
      return ref;
    }
  }
  if (state.localDefault !== null && usable(state, state.localDefault)) {
    return state.localDefault;
  }
  if (state.defaultModel !== null && usable(state, state.defaultModel)) {
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
