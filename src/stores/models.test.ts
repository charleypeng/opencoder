// L1 tests for the model store (TASK-M5-05): catalog replacement + loaded
// flag, config default override, per-session selection, the resolution
// fallback chain (selection -> session model -> config default -> first
// connected model), validation against the catalog and per-server reset.

import { beforeEach, describe, expect, it } from "vitest";
import type { Model, Provider, ProviderListResponse } from "../services/provider.js";
import {
  activeModelFor,
  getServerModelState,
  modelStates,
  resetServer,
  setConfigDefault,
  setModelForSession,
  setProviders,
} from "./models.js";

const SERVER = "srv-models";

function model(id: string, overrides: Partial<Model> = {}): Model {
  return {
    id,
    providerID: id.split(":")[0],
    name: id,
    api: { id, url: "https://example.com/v1", npm: "@ai-sdk/x" },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1, output: 2, cache: { read: 0.5, write: 1 } },
    limit: { context: 200000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-01-01",
    ...overrides,
  };
}

function provider(id: string, models: Model[]): Provider {
  const record: Record<string, Model> = {};
  for (const m of models) record[m.id] = m;
  return { id, name: id, source: "env", env: [], options: {}, models: record };
}

const OPENAI = provider("openai", [
  model("openai:gpt-5", { capabilities: { ...model("x").capabilities, reasoning: true } }),
  model("openai:gpt-4.1"),
]);
const ANTHROPIC = provider("anthropic", [model("anthropic:claude-sonnet-4-5")]);
const AZURE = provider("azure", [model("azure:gpt-4o")]);

const RESPONSE: ProviderListResponse = {
  all: [OPENAI, ANTHROPIC, AZURE],
  default: { openai: "openai:gpt-5" },
  connected: ["openai", "anthropic"],
};

beforeEach(() => {
  resetServer(SERVER);
});

describe("setProviders", () => {
  it("stores the catalog, connected ids, defaults and marks the server loaded", () => {
    setProviders(SERVER, RESPONSE);

    const state = getServerModelState(SERVER);
    expect(state.loaded).toBe(true);
    expect(state.providers).toHaveLength(3);
    expect(state.connected).toEqual(["openai", "anthropic"]);
    expect(state.defaultModels).toEqual({ openai: "openai:gpt-5" });
    expect(state.defaultModel).toEqual({ providerID: "openai", modelID: "openai:gpt-5" });
    expect(modelStates[SERVER]).toEqual(state);
  });

  it("resets when a fresh server is touched", () => {
    expect(getServerModelState(SERVER).loaded).toBe(false);
    expect(getServerModelState(SERVER).providers).toEqual([]);
  });

  it("replacement keeps existing per-session selections", () => {
    setProviders(SERVER, RESPONSE);
    setModelForSession(SERVER, "ses_1", { providerID: "openai", modelID: "openai:gpt-5" });
    setProviders(SERVER, { ...RESPONSE, all: [OPENAI] });

    expect(activeModelFor(SERVER, "ses_1")).toEqual({
      providerID: "openai",
      modelID: "openai:gpt-5",
    });
  });
});

describe("setConfigDefault", () => {
  it("overrides the default models with the /config/providers record", () => {
    setProviders(SERVER, RESPONSE);
    setConfigDefault(SERVER, { anthropic: "anthropic:claude-sonnet-4-5" });

    const state = getServerModelState(SERVER);
    expect(state.defaultModels).toEqual({ anthropic: "anthropic:claude-sonnet-4-5" });
    expect(state.defaultModel).toEqual({
      providerID: "anthropic",
      modelID: "anthropic:claude-sonnet-4-5",
    });
  });

  it("works without a prior provider fetch", () => {
    setConfigDefault(SERVER, { openai: "openai:gpt-5" });

    expect(getServerModelState(SERVER).defaultModel).toEqual({
      providerID: "openai",
      modelID: "openai:gpt-5",
    });
    expect(getServerModelState(SERVER).loaded).toBe(false);
  });
});

describe("activeModelFor", () => {
  it("resolves the config default when nothing else is set", () => {
    setProviders(SERVER, RESPONSE);
    expect(activeModelFor(SERVER, "ses_1")).toEqual({
      providerID: "openai",
      modelID: "openai:gpt-5",
    });
  });

  it("prefers the per-session selection once recorded", () => {
    setProviders(SERVER, RESPONSE);
    setModelForSession(SERVER, "ses_1", { providerID: "openai", modelID: "openai:gpt-4.1" });

    expect(activeModelFor(SERVER, "ses_1")).toEqual({
      providerID: "openai",
      modelID: "openai:gpt-4.1",
    });
    expect(activeModelFor(SERVER, "ses_2")).toEqual({
      providerID: "openai",
      modelID: "openai:gpt-5",
    });
  });

  it("falls back to the session's own model when still in the catalog", () => {
    setProviders(SERVER, RESPONSE);
    expect(activeModelFor(SERVER, "ses_1", { id: "openai:gpt-4.1", providerID: "openai" })).toEqual(
      { providerID: "openai", modelID: "openai:gpt-4.1" },
    );
  });

  it("ignores a session model that vanished from the catalog", () => {
    setProviders(SERVER, RESPONSE);
    expect(activeModelFor(SERVER, "ses_1", { id: "openai:gone", providerID: "openai" })).toEqual({
      providerID: "openai",
      modelID: "openai:gpt-5",
    });
  });

  it("drops a session model whose provider is disconnected", () => {
    setProviders(SERVER, { ...RESPONSE, connected: ["anthropic"] });
    expect(activeModelFor(SERVER, "ses_1", { id: "openai:gpt-5", providerID: "openai" })).toEqual({
      providerID: "anthropic",
      modelID: "anthropic:claude-sonnet-4-5",
    });
  });

  it("drops a selection that vanished from the catalog", () => {
    setProviders(SERVER, RESPONSE);
    setModelForSession(SERVER, "ses_1", { providerID: "openai", modelID: "openai:gpt-4.1" });
    setProviders(SERVER, {
      ...RESPONSE,
      all: [provider("openai", [model("openai:gpt-5")]), ANTHROPIC, AZURE],
    });

    expect(activeModelFor(SERVER, "ses_1")).toEqual({
      providerID: "openai",
      modelID: "openai:gpt-5",
    });
  });

  it("falls back to the first model of the first connected provider without a default", () => {
    setProviders(SERVER, { ...RESPONSE, default: {}, connected: ["anthropic", "openai"] });

    expect(activeModelFor(SERVER, "ses_1")).toEqual({
      providerID: "openai",
      modelID: "openai:gpt-5",
    });
  });

  it("never resolves to an unconnected provider's model as fallback", () => {
    setProviders(SERVER, { ...RESPONSE, default: {}, connected: ["openai"] });

    expect(activeModelFor(SERVER, "ses_1")).toEqual({
      providerID: "openai",
      modelID: "openai:gpt-5",
    });
  });

  it("returns null without any usable model", () => {
    expect(activeModelFor(SERVER, "ses_1")).toBeNull();
    setProviders(SERVER, { ...RESPONSE, default: {}, connected: [] });
    expect(activeModelFor(SERVER, "ses_1")).toBeNull();
  });
});

describe("resetServer", () => {
  it("drops the whole server bucket", () => {
    setProviders(SERVER, RESPONSE);
    setModelForSession(SERVER, "ses_1", { providerID: "openai", modelID: "openai:gpt-4.1" });
    resetServer(SERVER);

    expect(getServerModelState(SERVER)).toEqual({
      providers: [],
      connected: [],
      defaultModels: {},
      defaultModel: null,
      loaded: false,
      activeBySession: {},
    });
    expect(modelStates[SERVER]).toBeUndefined();
  });
});
