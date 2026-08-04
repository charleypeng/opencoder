// L2 tests for the summarize dialog (TASK-M6-06): a compact provider/model
// select (connected providers only, the session's own model preselected
// when connected), a Confirm that POSTs /session/{id}/summarize with the
// chosen pair, in-flight disablement with a progress hint, inline failure
// surfacing and a success toast. The catalog comes from the models store
// (seeded in tests), so no provider fetch is needed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import SummarizeDialog from "./SummarizeDialog";
import type { Model, Provider } from "../../services/provider";
import type { Session } from "../../services/session";
import { resetServer as resetModels, setProviders } from "../../stores/models";
import { applySessionList, resetServer as resetSessions } from "../../stores/session";
import { clearToasts, toasts } from "../../stores/toasts";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-summarize";
const SESSION_ID = "sess_sum_01";

function model(id: string, providerID: string): Model {
  return { id, providerID, name: id } as Model;
}

function provider(id: string, name: string, models: Model[]): Provider {
  const record: Record<string, Model> = {};
  for (const m of models) record[m.id] = m;
  return { id, name, source: "env", env: [], options: {}, models: record };
}

const OPENAI = provider("openai", "OpenAI", [model("gpt-5", "openai"), model("gpt-4o", "openai")]);
const ANTHROPIC = provider("anthropic", "Anthropic", [model("claude-sonnet-4", "anthropic")]);
const AZURE = provider("azure", "Azure", [model("gpt-4o-azure", "azure")]);

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: SESSION_ID,
    slug: "summarize-me",
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: "Summarize me",
    version: "1.18.11",
    time: { created: 1000, updated: 1000 },
    ...overrides,
  } as Session;
}

/** A fake ApiClient for the session service factory inside the component. */
function mockClient() {
  const client = {
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => undefined),
    post: vi.fn<(path: string, options?: { body?: unknown }) => Promise<unknown>>(
      async () => undefined,
    ),
    patch: vi.fn<(path: string, options?: { body?: unknown }) => Promise<unknown>>(
      async () => undefined,
    ),
    delete: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

beforeEach(() => {
  resetSessions(SERVER);
  resetModels(SERVER);
  clearToasts();
  getApiClientMock.mockReset();
  mockClient();
});

afterEach(() => {
  resetSessions(SERVER);
  resetModels(SERVER);
  clearToasts();
});

/** Seeds the models store with connected + unconnected providers. */
function seedModels() {
  setProviders(SERVER, {
    all: [OPENAI, ANTHROPIC, AZURE],
    default: { openai: "gpt-5" },
    connected: ["openai", "anthropic"],
  });
}

function renderDialog(overrides: Partial<Session> = {}, onClose = vi.fn()) {
  render(() => (
    <SummarizeDialog serverId={SERVER} session={session(overrides)} onClose={onClose} />
  ));
  return onClose;
}

describe("SummarizeDialog (TASK-M6-06)", () => {
  it("preselects the session's own model when its provider is connected", () => {
    seedModels();
    applySessionList(SERVER, [
      session({ model: { id: "claude-sonnet-4", providerID: "anthropic" } }),
    ]);
    renderDialog({ model: { id: "claude-sonnet-4", providerID: "anthropic" } });

    expect(screen.getByTestId("model-select-provider")).toHaveValue("anthropic");
    expect(screen.getByTestId("model-select-model")).toHaveValue("claude-sonnet-4");
  });

  it("lists only connected providers in the select", () => {
    seedModels();
    applySessionList(SERVER, [session()]);
    renderDialog();

    const options = within(screen.getByTestId("model-select-provider")).getAllByRole("option");
    const values = options.map((option) => (option as HTMLOptionElement).value);
    expect(values).toEqual(["openai", "anthropic"]);
  });

  it("falls back to a connected provider when the session model's provider is disconnected", () => {
    seedModels();
    setProviders(SERVER, {
      all: [OPENAI, ANTHROPIC, AZURE],
      default: { openai: "gpt-5" },
      connected: ["anthropic"],
    });
    applySessionList(SERVER, [session({ model: { id: "gpt-5", providerID: "openai" } })]);
    renderDialog({ model: { id: "gpt-5", providerID: "openai" } });

    const options = within(screen.getByTestId("model-select-provider")).getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(["anthropic"]);
    expect(screen.getByTestId("model-select-model")).toHaveValue("claude-sonnet-4");
    expect(screen.getByTestId("summarize-confirm")).toBeEnabled();
  });

  it("shows a hint and disables confirm when no provider is connected", () => {
    seedModels();
    setProviders(SERVER, {
      all: [AZURE],
      default: {},
      connected: [],
    });
    applySessionList(SERVER, [session()]);
    renderDialog();

    expect(screen.getByTestId("model-select-empty")).toBeInTheDocument();
    expect(screen.getByTestId("summarize-confirm")).toBeDisabled();
  });

  it("confirm POSTs summarize with the selected provider/model and toasts success", async () => {
    seedModels();
    applySessionList(SERVER, [session()]);
    const client = mockClient();
    client.post.mockResolvedValue(true);
    renderDialog();

    fireEvent.click(screen.getByTestId("summarize-confirm"));

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session/sess_sum_01/summarize", {
        body: { providerID: "openai", modelID: "gpt-5" },
      }),
    );
    await waitFor(() =>
      expect(toasts.some((toast) => toast.message === "Context compressed")).toBe(true),
    );
  });

  it("changing the provider switches the model list and the submitted pair", async () => {
    seedModels();
    applySessionList(SERVER, [session()]);
    const client = mockClient();
    client.post.mockResolvedValue(true);
    renderDialog();

    fireEvent.change(screen.getByTestId("model-select-provider"), {
      target: { value: "anthropic" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("model-select-model")).toHaveValue("claude-sonnet-4"),
    );
    fireEvent.click(screen.getByTestId("summarize-confirm"));

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session/sess_sum_01/summarize", {
        body: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      }),
    );
  });

  it("disables confirm and shows a progress hint while compressing", async () => {
    seedModels();
    applySessionList(SERVER, [session()]);
    const client = mockClient();
    let resolvePost: (value: unknown) => void = () => undefined;
    client.post.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );
    renderDialog();

    fireEvent.click(screen.getByTestId("summarize-confirm"));

    await waitFor(() => expect(screen.getByTestId("summarize-confirm")).toBeDisabled());
    expect(screen.getByTestId("summarize-confirm")).toHaveTextContent(/Compressing/);
    resolvePost(true);
    await waitFor(() =>
      expect(toasts.some((toast) => toast.message === "Context compressed")).toBe(true),
    );
  });

  it("a failed summarize shows the inline error and keeps the dialog open", async () => {
    seedModels();
    applySessionList(SERVER, [session()]);
    const client = mockClient();
    client.post.mockRejectedValue({
      status: 400,
      code: "http",
      message: "bad model",
      retriable: false,
    });
    renderDialog();

    fireEvent.click(screen.getByTestId("summarize-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("summarize-error")).toHaveTextContent(/bad model/),
    );
    expect(screen.getByTestId("summarize-dialog")).toBeInTheDocument();
    expect(toasts.length).toBe(0);
  });

  it("Esc closes the dialog through onClose", () => {
    seedModels();
    applySessionList(SERVER, [session()]);
    const onClose = renderDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
