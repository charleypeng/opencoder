// L2 tests for the Models settings section (TASK-S1-01): the effective
// default display (local choice ?? config default), the Change dialog
// reusing the model picker with the selection targeting the per-server
// local default (store slot + localStorage persistence), the Clear button
// resetting to the server default, and the empty/retry state when the
// catalog fetch fails.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import ModelsSection from "./ModelsSection";
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

const SERVER = "srv-models-section";

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

function mockClient() {
  const client = {
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async (path: string) => {
      if (path === "/provider") return LIST;
      if (path === "/config/providers") return CONFIG;
      return [];
    }),
    post: vi.fn<(path: string, options?: { body?: unknown }) => Promise<unknown>>(
      async () => undefined,
    ),
    patch: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => undefined),
    delete: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

let client: ReturnType<typeof mockClient>;

beforeEach(() => {
  resetModels(SERVER);
  window.localStorage.clear();
  getApiClientMock.mockReset();
  client = mockClient();
});

afterEach(() => {
  resetModels(SERVER);
  window.localStorage.clear();
});

describe("ModelsSection", () => {
  it("shows the config default when no local choice is set", () => {
    setProviders(SERVER, LIST);
    setConfigDefault(SERVER, LIST.default ?? {});

    render(() => <ModelsSection serverId={SERVER} />);

    expect(screen.getByTestId("models-section")).toBeInTheDocument();
    expect(screen.getByTestId("models-default-value")).toHaveTextContent("OpenAI · GPT-5");
    expect(screen.getByTestId("models-server-chip")).toHaveTextContent("Default");
    expect(screen.queryByTestId("models-local-chip")).not.toBeInTheDocument();
    expect(screen.getByTestId("models-default-change")).toBeInTheDocument();
    expect(screen.queryByTestId("models-default-clear")).not.toBeInTheDocument();
  });

  it("shows the local default with its chip and the Clear button", () => {
    setProviders(SERVER, LIST);
    setLocalDefault(SERVER, { providerID: "anthropic", modelID: "claude-sonnet-4-5" });

    render(() => <ModelsSection serverId={SERVER} />);

    expect(screen.getByTestId("models-default-value")).toHaveTextContent(
      "Anthropic · Claude Sonnet 4.5",
    );
    expect(screen.getByTestId("models-local-chip")).toHaveTextContent("Local default");
    expect(screen.queryByTestId("models-server-chip")).not.toBeInTheDocument();
    expect(screen.getByTestId("models-default-clear")).toBeInTheDocument();
  });

  it("shows a not-set state when the server exposes no default", () => {
    setProviders(SERVER, { ...LIST, default: {} });

    render(() => <ModelsSection serverId={SERVER} />);

    expect(screen.queryByTestId("models-default-value")).not.toBeInTheDocument();
    expect(screen.getByTestId("models-default-change")).toBeInTheDocument();
  });

  it("picking in the Change dialog sets and persists the local default", async () => {
    setProviders(SERVER, LIST);
    render(() => <ModelsSection serverId={SERVER} />);

    fireEvent.click(screen.getByTestId("models-default-change"));
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
    // The dialog closes and the section reflects the new choice.
    expect(screen.queryByTestId("models-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("models-default-value")).toHaveTextContent(
      "Anthropic · Claude Sonnet 4.5",
    );
    expect(screen.getByTestId("models-local-chip")).toBeInTheDocument();
  });

  it("clearing resets to the server default and removes the stored key", () => {
    setProviders(SERVER, LIST);
    setLocalDefault(SERVER, { providerID: "anthropic", modelID: "claude-sonnet-4-5" });
    render(() => <ModelsSection serverId={SERVER} />);

    fireEvent.click(screen.getByTestId("models-default-clear"));

    expect(getServerModelState(SERVER).localDefault).toBeNull();
    expect(localStorage.getItem(DEFAULT_MODEL_STORAGE_PREFIX + SERVER)).toBeNull();
    expect(screen.getByTestId("models-default-value")).toHaveTextContent("OpenAI · GPT-5");
    expect(screen.queryByTestId("models-local-chip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("models-default-clear")).not.toBeInTheDocument();
    expect(screen.getByTestId("models-cleared")).toHaveTextContent(
      "Cleared — back to the server default.",
    );
  });

  it("fetches the catalog on mount when nothing is loaded", async () => {
    render(() => <ModelsSection serverId={SERVER} />);

    await screen.findByTestId("models-default-value");
    expect(client.get).toHaveBeenCalledWith("/provider", undefined);
    expect(client.get).toHaveBeenCalledWith("/config/providers", undefined);
  });

  it("offers a retry when the catalog fetch fails", async () => {
    client.get.mockImplementation(async (path: string) => {
      if (path === "/provider") return Promise.reject(new Error("boom"));
      if (path === "/config/providers") return CONFIG;
      return [];
    });
    render(() => <ModelsSection serverId={SERVER} />);

    await screen.findByTestId("models-retry");
    expect(screen.getByTestId("models-empty")).toBeInTheDocument();

    client.get.mockImplementation(async (path: string) => {
      if (path === "/provider") return LIST;
      if (path === "/config/providers") return CONFIG;
      return [];
    });
    fireEvent.click(screen.getByTestId("models-retry"));

    await screen.findByTestId("models-default-value");
    expect(screen.getByTestId("models-default-value")).toHaveTextContent("OpenAI · GPT-5");
  });
});
