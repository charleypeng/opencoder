// L2 tests for the provider API-key panel (TASK-M5-06): the provider rows
// with connected badges and per-auth-method forms (api key form for `api`
// methods, deferred note for `oauth`), saving a key PUTs /auth/{id} and
// refreshes the provider catalog so the connected state updates, removing
// a key goes through an inline confirmation and then DELETEs + refreshes,
// and load/mutation failures surface inline with retry.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import ProviderKeys from "./ProviderKeys";
import type {
  Provider,
  ProviderAuthMethodsResponse,
  ProviderListResponse,
} from "../../../services/provider";
import { getServerModelState, resetServer as resetModels } from "../../../stores/models";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../../services/client.js", () => ({ getApiClient: getApiClientMock }));

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
    post: vi.fn(async () => undefined),
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
    expect(within(azure).getByTestId("provider-oauth-note")).toHaveTextContent(
      "OAuth sign-in is not available yet.",
    );
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
