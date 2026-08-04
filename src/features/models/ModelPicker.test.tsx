// L2 tests for the model picker dialog (TASK-M5-05): the provider group
// headers with the unconnected tag, capability badges, cost + context
// hints, the Default marker (from the /config/providers default record),
// the favorites section with the localStorage-persisted star toggle, the
// search filter, the Current marker, and selection recording the
// per-session model in the store and closing the dialog.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import ModelPicker from "./ModelPicker";
import type {
  ConfigProvidersResponse,
  Model,
  Provider,
  ProviderListResponse,
} from "../../services/provider";
import { activeModelFor, resetServer as resetModels } from "../../stores/models";
import { applySessionList, resetServer as resetSessions } from "../../stores/session";
import { FAVORITES_STORAGE_KEY } from "./models";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-picker";
const SESSION = "ses_picker_01";

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

function capabilities(overrides: Partial<Model["capabilities"]> = {}): Model["capabilities"] {
  return {
    temperature: true,
    reasoning: false,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
    ...overrides,
  };
}

const OPENAI = provider("openai", "OpenAI", [
  model("gpt-5", {
    name: "GPT-5",
    capabilities: capabilities({
      reasoning: true,
      input: { ...capabilities().input, image: true },
    }),
  }),
  model("gpt-4.1", { name: "GPT-4.1" }),
]);
const ANTHROPIC = provider("anthropic", "Anthropic", [
  model("claude-sonnet-4-5", {
    name: "Claude Sonnet 4.5",
    providerID: "anthropic",
    capabilities: capabilities({ reasoning: true }),
    cost: { input: 3, output: 15, cache: { read: 1.5, write: 3 } },
    limit: { context: 200000, output: 64000 },
  }),
]);
const AZURE = provider("azure", "Azure OpenAI", [
  model("gpt-4o", {
    name: "GPT-4o",
    providerID: "azure",
    capabilities: capabilities({ input: { ...capabilities().input, image: true } }),
  }),
]);

const LIST: ProviderListResponse = {
  all: [OPENAI, ANTHROPIC, AZURE],
  default: { openai: "gpt-5" },
  connected: ["openai", "anthropic"],
};
const CONFIG: ConfigProvidersResponse = {
  providers: [OPENAI, ANTHROPIC, AZURE],
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
  resetSessions(SERVER);
  resetModels(SERVER);
  window.localStorage.clear();
  getApiClientMock.mockReset();
  client = mockClient();
  applySessionList(SERVER, [
    {
      id: SESSION,
      slug: "picker-session",
      projectID: "project-mock-1",
      directory: "/mock/projects/opencode-demo",
      title: "Picker session",
      agent: "build",
      model: { id: "gpt-5", providerID: "openai" },
      version: "1.18.11",
      time: { created: 1, updated: 1 },
    },
  ]);
});

afterEach(() => {
  resetSessions(SERVER);
  resetModels(SERVER);
  window.localStorage.clear();
});

function renderPicker(onOpenChange = vi.fn()) {
  return render(() => (
    <ModelPicker serverId={SERVER} sessionId={SESSION} open onOpenChange={onOpenChange} />
  ));
}

describe("ModelPicker", () => {
  it("groups models by provider with headers and fetches the catalog on open", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.getByText("Azure OpenAI")).toBeInTheDocument();
    expect(screen.getAllByTestId("model-group")[0].getAttribute("data-provider")).toBe("openai");
    expect(client.get).toHaveBeenCalledWith("/provider", undefined);
    expect(client.get).toHaveBeenCalledWith("/config/providers", undefined);
  });

  it("keeps the provider catalog when the config fetch fails", async () => {
    client.get.mockImplementation(async (path: string) => {
      if (path === "/provider") return LIST;
      if (path === "/config/providers") return Promise.reject(new Error("config boom"));
      return [];
    });
    renderPicker();

    // The catalog still populates: all three provider groups render and
    // the /provider default record marks openai/gpt-5 as the default.
    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    expect(screen.getAllByTestId("model-default")).toHaveLength(1);
    expect(
      screen
        .getByTestId("model-default")
        .closest("[data-testid='model-item']")
        ?.getAttribute("data-model"),
    ).toBe("gpt-5");
  });

  it("grays out an unconnected provider: tag, grayed rows and disabled select", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    const azureItems = screen
      .getAllByTestId("model-item")
      .filter((item) => item.getAttribute("data-provider") === "azure");
    expect(azureItems).toHaveLength(1);
    expect(azureItems[0].getAttribute("data-connected")).toBe("false");
    expect(azureItems[0].className).toContain("opacity-40");
    expect(
      (azureItems[0].querySelector("[data-testid='model-item-select']") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getAllByTestId("model-not-connected")).toHaveLength(1);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("shows capability badges only for the true capabilities", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    const badges = screen.getAllByTestId("model-badge").map((b) => b.textContent);
    expect(badges).toEqual([
      "tools",
      "vision",
      "reasoning",
      "tools",
      "tools",
      "reasoning",
      "tools",
      "vision",
    ]);
  });

  it("shows cost and context-limit hints per model", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    expect(screen.getAllByTestId("model-cost")[0]).toHaveTextContent("$1.25/M in · $10/M out");
    expect(screen.getAllByTestId("model-context")[0]).toHaveTextContent("400K context");
    expect(screen.getByText("$3/M in · $15/M out")).toBeInTheDocument();
    expect(screen.getByText("200K context")).toBeInTheDocument();
  });

  it("marks the config default model with the Default badge", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    const defaults = screen.getAllByTestId("model-default");
    expect(defaults).toHaveLength(1);
    const row = defaults[0].closest("[data-testid='model-item']");
    expect(row?.getAttribute("data-model")).toBe("gpt-5");
  });

  it("marks the current model with the Current check", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    const active = screen.getAllByTestId("model-active");
    expect(active).toHaveLength(1);
    expect(active[0].closest("[data-testid='model-item']")?.getAttribute("data-model")).toBe(
      "gpt-5",
    );
  });

  it("selecting a model records the per-session choice and closes", async () => {
    const onOpenChange = vi.fn();
    renderPicker(onOpenChange);

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    const claudeRow = screen
      .getAllByTestId("model-item")
      .find((item) => item.getAttribute("data-model") === "claude-sonnet-4-5");
    fireEvent.click(claudeRow!.querySelector("[data-testid='model-item-select']")!);

    expect(activeModelFor(SERVER, SESSION)).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not select a disabled (unconnected) model", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    const azureSelect = screen
      .getAllByTestId("model-item")
      .find((item) => item.getAttribute("data-provider") === "azure")!
      .querySelector("[data-testid='model-item-select']")! as HTMLButtonElement;
    expect(azureSelect.disabled).toBe(true);
    fireEvent.click(azureSelect);
    expect(activeModelFor(SERVER, SESSION)).toEqual({ providerID: "openai", modelID: "gpt-5" });
  });

  it("favorites: star toggle moves the model into the favorites section and persists", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    expect(screen.queryByTestId("model-favorites-section")).not.toBeInTheDocument();

    const favButton = screen
      .getAllByTestId("model-item")
      .find((item) => item.getAttribute("data-model") === "gpt-4.1")!
      .querySelector("[data-testid='model-fav']")! as HTMLButtonElement;
    fireEvent.click(favButton);

    expect(screen.getByTestId("model-favorites-section")).toBeInTheDocument();
    const favoriteRow = screen
      .getByTestId("model-favorites-section")
      .querySelector("[data-testid='model-item']");
    expect(favoriteRow?.getAttribute("data-model")).toBe("gpt-4.1");
    expect(favButton.getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? "[]")).toEqual([
      "openai:gpt-4.1",
    ]);

    // Toggling again removes the model from the favorites section.
    fireEvent.click(favButton);
    expect(screen.queryByTestId("model-favorites-section")).not.toBeInTheDocument();
    expect(favButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("favorites restore from localStorage when the dialog opens", async () => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(["openai:gpt-4.1"]));
    renderPicker();

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    expect(screen.getByTestId("model-favorites-section")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("model-favorites-section")
        .querySelector("[data-testid='model-item']")
        ?.getAttribute("data-model"),
    ).toBe("gpt-4.1");
  });

  it("search filters by provider or model name", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getAllByTestId("model-group")).toHaveLength(3));
    const search = screen.getByTestId("model-picker-search") as HTMLInputElement;

    fireEvent.input(search, { target: { value: "claude" } });
    const groups = screen.getAllByTestId("model-group");
    expect(groups).toHaveLength(1);
    expect(groups[0].getAttribute("data-provider")).toBe("anthropic");

    // A provider-name match shows all of that provider's models.
    fireEvent.input(search, { target: { value: "azure" } });
    const azureModels = screen
      .getAllByTestId("model-item")
      .filter((item) => item.getAttribute("data-provider") === "azure");
    expect(azureModels).toHaveLength(1);

    fireEvent.input(search, { target: { value: "zzz_no_match" } });
    expect(screen.getByTestId("model-picker-empty")).toHaveTextContent("No matching models");
    expect(screen.queryByTestId("model-group")).not.toBeInTheDocument();
  });

  it("closes via the Close button", async () => {
    const onOpenChange = vi.fn();
    renderPicker(onOpenChange);

    fireEvent.click(screen.getByTestId("model-picker-close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
