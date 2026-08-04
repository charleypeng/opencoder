// L2 tests for the provider keys panel (TASK-M5-06/07): the provider rows
// with connected badges and per-auth-method UI (api key form for `api`
// methods, an Authorize button opening the OAuth dialog for `oauth`
// methods), saving a key PUTs /auth/{id} and refreshes the provider
// catalog so the connected state updates, removing a key goes through an
// inline confirmation and then DELETEs + refreshes, and load/mutation
// failures surface inline with retry.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import ProviderKeys from "./ProviderKeys";
import type {
  Provider,
  ProviderAuthMethodsResponse,
  ProviderListResponse,
} from "../../../services/provider";
import { getServerModelState, resetServer as resetModels } from "../../../stores/models";

const { getApiClientMock, openUrlMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  openUrlMock: vi.fn(),
}));

vi.mock("../../../services/client.js", () => ({ getApiClient: getApiClientMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

const SERVER = "srv-keys";

function provider(id: string, name: string): Provider {
  return { id, name, source: "env", env: [], options: {}, models: {} };
}

const OPENAI = provider("openai", "OpenAI");
const ANTHROPIC = provider("anthropic", "Anthropic");
const AZURE = provider("azure", "Azure OpenAI");

function listResponse(connected: string[]): ProviderListResponse {
  return { all: [OPENAI, ANTHROPIC, AZURE], default: { openai: "gpt-5" }, connected };
}

const AUTH_METHODS: ProviderAuthMethodsResponse = {
  openai: [{ type: "api", label: "API key" }],
  anthropic: [{ type: "api", label: "API key" }],
  azure: [{ type: "oauth", label: "OAuth" }],
};

function mockClient() {
  let connected: string[] = ["openai"];
  const client = {
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async (path: string) => {
      if (path === "/provider/auth") return AUTH_METHODS;
      if (path === "/provider") return listResponse(connected);
      return [];
    }),
    put: vi.fn<(path: string, options?: { body?: unknown }) => Promise<unknown>>(async () => true),
    delete: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => true),
    post: vi.fn<(path: string, options?: { body?: unknown }) => Promise<unknown>>(
      async (path: string) => {
        if (path.endsWith("/oauth/authorize")) {
          return {
            url: "https://auth.example/azure",
            method: "auto",
            instructions: "Complete the authorization in the browser.",
          };
        }
        // Auto-mode callback polls stay pending.
        return false;
      },
    ),
    patch: vi.fn(async () => undefined),
  };
  // Lets tests mutate the connected set the mock /provider returns.
  (client as unknown as { __setConnected: (ids: string[]) => void }).__setConnected = (ids) => {
    connected = ids;
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

let client: ReturnType<typeof mockClient>;

beforeEach(() => {
  resetModels(SERVER);
  getApiClientMock.mockReset();
  openUrlMock.mockReset();
  openUrlMock.mockResolvedValue(undefined);
  client = mockClient();
});

afterEach(() => {
  resetModels(SERVER);
});

function renderKeys() {
  return render(() => <ProviderKeys serverId={SERVER} />);
}

function rowOf(providerID: string): HTMLElement {
  return screen.getByTestId(`provider-key-row-${providerID}`);
}

describe("ProviderKeys", () => {
  it("lists providers with connected badges and per-method forms", async () => {
    renderKeys();

    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));
    expect(client.get).toHaveBeenCalledWith("/provider/auth", undefined);
    expect(client.get).toHaveBeenCalledWith("/provider", undefined);

    const openai = rowOf("openai");
    expect(openai.getAttribute("data-connected")).toBe("true");
    expect(within(openai).getByTestId("provider-connected")).toHaveTextContent("Connected");
    expect(within(openai).getByTestId("provider-key-set")).toHaveTextContent("Key set");

    const anthropic = rowOf("anthropic");
    expect(anthropic.getAttribute("data-connected")).toBe("false");
    expect(within(anthropic).getByTestId("provider-connected")).toHaveTextContent("Not connected");
    expect(within(anthropic).getByTestId("provider-key-save")).toBeInTheDocument();

    expect(screen.getAllByTestId("provider-key-input")).toHaveLength(2);
    expect(screen.getAllByTestId("provider-key-save")).toHaveLength(2);

    const azure = rowOf("azure");
    expect(within(azure).getByTestId("provider-oauth-authorize")).toHaveTextContent("Authorize");
  });

  it("opens the OAuth dialog from the authorize button and closes on cancel", async () => {
    renderKeys();
    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));

    fireEvent.click(within(rowOf("azure")).getByTestId("provider-oauth-authorize"));

    await waitFor(() => expect(screen.getByTestId("provider-oauth-dialog")).toBeInTheDocument());
    expect(screen.getByText("Sign in to Azure OpenAI")).toBeInTheDocument();
    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/provider/azure/oauth/authorize", {
        body: { method: 0 },
      }),
    );
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith("https://auth.example/azure"));

    fireEvent.click(screen.getByTestId("provider-oauth-cancel"));
    await waitFor(() =>
      expect(screen.queryByTestId("provider-oauth-dialog")).not.toBeInTheDocument(),
    );
  });

  it("marks the key inputs to suppress password autofill", async () => {
    renderKeys();
    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));

    for (const input of screen.getAllByTestId("provider-key-input")) {
      expect(input).toHaveAttribute("autocomplete", "new-password");
    }
  });

  it("disables every row's save/remove while a mutation is in flight", async () => {
    let providerCalls = 0;
    let resolveRefresh: ((value: ProviderListResponse) => void) | undefined;
    client.get.mockImplementation(async (path: string) => {
      if (path === "/provider") {
        providerCalls += 1;
        // The mount load resolves immediately; the post-save refresh hangs
        // until the test releases it.
        if (providerCalls === 1) return listResponse(["openai"]);
        return new Promise<ProviderListResponse>((resolve) => {
          resolveRefresh = resolve;
        });
      }
      if (path === "/provider/auth") return AUTH_METHODS;
      return [];
    });
    renderKeys();
    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));

    fireEvent.input(within(rowOf("anthropic")).getByTestId("provider-key-input"), {
      target: { value: "sk-ant-secret" },
    });
    fireEvent.click(within(rowOf("anthropic")).getByTestId("provider-key-save"));
    await waitFor(() => expect(client.put).toHaveBeenCalled());

    // While the save's refresh is pending, no row may start another action.
    for (const save of screen.getAllByTestId("provider-key-save")) {
      expect((save as HTMLButtonElement).disabled).toBe(true);
    }
    for (const remove of screen.getAllByTestId("provider-key-remove")) {
      expect((remove as HTMLButtonElement).disabled).toBe(true);
    }

    resolveRefresh!(listResponse(["openai", "anthropic"]));
    // The save succeeded, so the draft cleared; the openai remove button
    // (disabled only by the busy lock) proves the row unlocked again.
    await waitFor(() =>
      expect((screen.getAllByTestId("provider-key-remove")[0] as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  it("drops a stale refresh response that resolves after a newer load", async () => {
    renderKeys();
    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));

    // The post-save refresh resolves late with the OLD catalog; a manual
    // refresh (load) in between returns the NEWER catalog immediately.
    // (The mount load already consumed the default mock, so the first
    // /provider call here is the save's refresh.)
    let providerCalls = 0;
    client.get.mockImplementation(async (path: string) => {
      if (path === "/provider") {
        providerCalls += 1;
        if (providerCalls === 1) {
          return new Promise<ProviderListResponse>((resolve) =>
            setTimeout(() => resolve(listResponse(["openai"])), 50),
          );
        }
        return listResponse(["openai", "anthropic"]);
      }
      if (path === "/provider/auth") return AUTH_METHODS;
      return [];
    });

    fireEvent.input(within(rowOf("anthropic")).getByTestId("provider-key-input"), {
      target: { value: "sk-ant-secret" },
    });
    fireEvent.click(within(rowOf("anthropic")).getByTestId("provider-key-save"));
    await waitFor(() => expect(client.put).toHaveBeenCalled());
    // The save's refresh is in flight; the Refresh button runs a newer load
    // that lands before the stale response.
    fireEvent.click(screen.getByTestId("provider-keys-refresh"));

    // The newer load's catalog wins; the stale response must not clobber it.
    await waitFor(() =>
      expect(getServerModelState(SERVER).connected).toEqual(["openai", "anthropic"]),
    );
    // Let the stale refresh land and confirm it was dropped by the guard.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(getServerModelState(SERVER).connected).toEqual(["openai", "anthropic"]);
  });

  it("saves an API key: PUTs the key and refreshes the connected state", async () => {
    renderKeys();
    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));

    fireEvent.input(within(rowOf("anthropic")).getByTestId("provider-key-input"), {
      target: { value: "sk-ant-secret" },
    });
    fireEvent.click(within(rowOf("anthropic")).getByTestId("provider-key-save"));

    await waitFor(() =>
      expect(client.put).toHaveBeenCalledWith("/auth/anthropic", {
        body: { type: "api", key: "sk-ant-secret" },
      }),
    );
    // Save triggers a provider re-list (connected refresh) and clears the draft.
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(3));
    expect(
      (within(rowOf("anthropic")).getByTestId("provider-key-input") as HTMLInputElement).value,
    ).toBe("");
  });

  it("marks a provider connected after its key is saved (refresh contract)", async () => {
    (client as unknown as { __setConnected: (ids: string[]) => void }).__setConnected([
      "openai",
      "anthropic",
    ]);
    renderKeys();
    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));

    fireEvent.input(within(rowOf("anthropic")).getByTestId("provider-key-input"), {
      target: { value: "sk-ant-secret" },
    });
    fireEvent.click(within(rowOf("anthropic")).getByTestId("provider-key-save"));

    await waitFor(() => expect(rowOf("anthropic").getAttribute("data-connected")).toBe("true"));
    expect(within(rowOf("anthropic")).getByTestId("provider-key-set")).toBeInTheDocument();
    expect(getServerModelState(SERVER).connected).toEqual(["openai", "anthropic"]);
  });

  it("does not save an empty key", async () => {
    renderKeys();
    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));

    const save = within(rowOf("anthropic")).getByTestId("provider-key-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    await waitFor(() => expect(client.put).not.toHaveBeenCalled());
  });

  it("removes a key through the inline confirmation and refreshes", async () => {
    renderKeys();
    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));

    const openai = rowOf("openai");
    // First click arms the confirmation (no DELETE yet).
    fireEvent.click(within(openai).getByTestId("provider-key-remove"));
    expect(client.delete).not.toHaveBeenCalled();
    expect(within(openai).getByTestId("provider-key-remove-confirm")).toBeInTheDocument();

    // Second click executes the removal + refresh.
    fireEvent.click(within(openai).getByTestId("provider-key-remove"));
    await waitFor(() => expect(client.delete).toHaveBeenCalledWith("/auth/openai", undefined));
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(3));
    expect(within(openai).queryByTestId("provider-key-remove-confirm")).not.toBeInTheDocument();
  });

  it("cancels a pending remove confirmation", async () => {
    renderKeys();
    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));

    const openai = rowOf("openai");
    fireEvent.click(within(openai).getByTestId("provider-key-remove"));
    expect(within(openai).getByTestId("provider-key-remove-confirm")).toBeInTheDocument();

    fireEvent.click(within(openai).getByTestId("provider-key-remove-cancel"));
    expect(client.delete).not.toHaveBeenCalled();
    expect(within(openai).queryByTestId("provider-key-remove-confirm")).not.toBeInTheDocument();
  });

  it("surfaces a save failure inline", async () => {
    client.put.mockRejectedValueOnce(new Error("boom"));
    renderKeys();
    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));

    fireEvent.input(within(rowOf("anthropic")).getByTestId("provider-key-input"), {
      target: { value: "sk-ant-secret" },
    });
    fireEvent.click(within(rowOf("anthropic")).getByTestId("provider-key-save"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-keys-error")).toHaveTextContent(
        "Failed to save the key for anthropic.",
      ),
    );
    // The draft survives so the user can retry without retyping.
    expect(
      (within(rowOf("anthropic")).getByTestId("provider-key-input") as HTMLInputElement).value,
    ).toBe("sk-ant-secret");
  });

  it("shows a load error with retry", async () => {
    client.get.mockRejectedValueOnce(new Error("boom"));
    renderKeys();

    await waitFor(() => expect(screen.getByTestId("provider-keys-load-error")).toBeInTheDocument());
    expect(screen.getByText("Failed to load providers.")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("provider-keys-retry"));
    await waitFor(() => expect(screen.getAllByTestId(/^provider-key-row-./)).toHaveLength(3));
  });
});
