// L2 tests for the client default-model row (TASK-S1-01, folded into
// Config per docs/ui-audit-2026-08 §7): the effective default display
// (local choice ?? config default), the Change dialog reusing the model
// picker with the selection targeting the per-server local default (store
// slot + localStorage persistence) and the Clear button resetting to the
// server default. The row itself does not fetch — ConfigSection pre-loads
// the catalog, and the picker refetches on open through the store.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import ModelDefaultRow from "./ModelDefaultRow";
import type {
  ConfigProvidersResponse,
  Model,
  Provider,
  ProviderListResponse,
} from "../../../services/provider";
import {
  DEFAULT_MODEL_STORAGE_PREFIX,
  getServerModelState,
  resetServer as resetModels,
  setConfigDefault,
  setLocalDefault,
  setProviders,
} from "../../../stores/models";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-model-default-row";

function model(id: string, overrides: Partial<Model> = {}): Model {
  return {
    id,
    providerID: "openai",
    name: id,
    api: { id, url: "https://example.com/v1", npm: "@ai-sdk/openai" },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1.25, output: 10, cache: { read: 0.625, write: 1.25 } },
    limit: { context: 400000, output: 128000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-08-07",
    ...overrides,
  };
}

function provider(id: string, name: string, models: Model[]): Provider {
  const record: Record<string, Model> = {};
  for (const m of models) record[m.id] = m;
  return { id, name, source: "env", env: [], options: {}, models: record };
}

const OPENAI = provider("openai", "OpenAI", [
  model("gpt-5", { name: "GPT-5" }),
  model("gpt-4.1", { name: "GPT-4.1" }),
]);
const ANTHROPIC = provider("anthropic", "Anthropic", [
  model("claude-sonnet-4-5", { name: "Claude Sonnet 4.5", providerID: "anthropic" }),
]);

const LIST: ProviderListResponse = {
  all: [OPENAI, ANTHROPIC],
  default: { openai: "gpt-5" },
  connected: ["openai", "anthropic"],
};
const CONFIG: ConfigProvidersResponse = {
  providers: [OPENAI, ANTHROPIC],
  default: { openai: "gpt-5" },
};

beforeEach(() => {
  resetModels(SERVER);
  window.localStorage.clear();
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue({
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async (path: string) => {
      if (path === "/provider") return LIST;
      if (path === "/config/providers") return CONFIG;
      return [];
    }),
    post: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  });
});

afterEach(() => {
  resetModels(SERVER);
  window.localStorage.clear();
});

describe("ModelDefaultRow", () => {
  it("shows the config default when no local choice is set", () => {
    setProviders(SERVER, LIST);
    setConfigDefault(SERVER, LIST.default ?? {});

    render(() => <ModelDefaultRow serverId={SERVER} />);

    expect(screen.getByTestId("model-default-row")).toBeInTheDocument();
    expect(screen.getByTestId("model-default-value")).toHaveTextContent("OpenAI · GPT-5");
    expect(screen.getByTestId("model-server-chip")).toHaveTextContent("Default");
    expect(screen.queryByTestId("model-local-chip")).not.toBeInTheDocument();
    expect(screen.getByTestId("model-default-change")).toBeInTheDocument();
    expect(screen.queryByTestId("model-default-clear")).not.toBeInTheDocument();
  });

  it("shows the local default with its chip and the Clear button", () => {
    setProviders(SERVER, LIST);
    setLocalDefault(SERVER, { providerID: "anthropic", modelID: "claude-sonnet-4-5" });

    render(() => <ModelDefaultRow serverId={SERVER} />);

    expect(screen.getByTestId("model-default-value")).toHaveTextContent(
      "Anthropic · Claude Sonnet 4.5",
    );
    expect(screen.getByTestId("model-local-chip")).toHaveTextContent("Local default");
    expect(screen.queryByTestId("model-server-chip")).not.toBeInTheDocument();
    expect(screen.getByTestId("model-default-clear")).toBeInTheDocument();
  });

  it("falls back to the config default when the local default's provider disconnects", () => {
    setProviders(SERVER, { ...LIST, connected: ["openai"] });
    setLocalDefault(SERVER, { providerID: "anthropic", modelID: "claude-sonnet-4-5" });

    render(() => <ModelDefaultRow serverId={SERVER} />);

    expect(screen.getByTestId("model-default-value")).toHaveTextContent("OpenAI · GPT-5");
    expect(screen.getByTestId("model-server-chip")).toHaveTextContent("Default");
    expect(screen.queryByTestId("model-local-chip")).not.toBeInTheDocument();
    // The Clear button still clears the stale local slot.
    expect(screen.getByTestId("model-default-clear")).toBeInTheDocument();
  });

  it("shows a not-set state when the server exposes no default", () => {
    setProviders(SERVER, { ...LIST, default: {} });

    render(() => <ModelDefaultRow serverId={SERVER} />);

    expect(screen.queryByTestId("model-default-value")).not.toBeInTheDocument();
    expect(screen.getByTestId("model-default-change")).toBeInTheDocument();
  });

  it("picking in the Change dialog sets and persists the local default", async () => {
    setProviders(SERVER, LIST);
    render(() => <ModelDefaultRow serverId={SERVER} />);

    fireEvent.click(screen.getByTestId("model-default-change"));
    const search = await screen.findByTestId("model-picker-search");
    expect(search).toBeInTheDocument();

    const claudeRow = screen
      .getAllByTestId("model-item")
      .find((item) => item.getAttribute("data-model") === "claude-sonnet-4-5");
    fireEvent.click(claudeRow!.querySelector("[data-testid='model-item-select']")!);

    expect(getServerModelState(SERVER).localDefault).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
    });
    expect(
      JSON.parse(localStorage.getItem(DEFAULT_MODEL_STORAGE_PREFIX + SERVER) ?? "null"),
    ).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-5" });
    // The dialog closes and the row reflects the new choice.
    expect(screen.queryByTestId("model-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("model-default-value")).toHaveTextContent(
      "Anthropic · Claude Sonnet 4.5",
    );
    expect(screen.getByTestId("model-local-chip")).toBeInTheDocument();
  });

  it("clearing resets to the server default and removes the stored key", () => {
    setProviders(SERVER, LIST);
    setLocalDefault(SERVER, { providerID: "anthropic", modelID: "claude-sonnet-4-5" });
    render(() => <ModelDefaultRow serverId={SERVER} />);

    fireEvent.click(screen.getByTestId("model-default-clear"));

    expect(getServerModelState(SERVER).localDefault).toBeNull();
    expect(localStorage.getItem(DEFAULT_MODEL_STORAGE_PREFIX + SERVER)).toBeNull();
    expect(screen.getByTestId("model-default-value")).toHaveTextContent("OpenAI · GPT-5");
    expect(screen.queryByTestId("model-local-chip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("model-default-clear")).not.toBeInTheDocument();
    expect(screen.getByTestId("model-cleared")).toHaveTextContent(
      "Cleared — back to the server default.",
    );
  });
});
