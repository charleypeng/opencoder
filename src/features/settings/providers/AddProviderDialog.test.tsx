// L2 tests for the provider add dialog (TASK-S1-02): the form renders the
// id/name/baseURL/apiKey fields plus a scope toggle (global default,
// project PATCHes /config), validation disables submit on an empty or
// non-slug id, a key without a base URL shows the built-in-endpoint hint,
// a successful global add PATCHes /global/config with the provider entry,
// re-fetches the provider catalog into the models store, toasts and
// closes, while failures stay inline with the dialog open.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal, Show } from "solid-js";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import AddProviderDialog from "./AddProviderDialog";
import type { Provider, ProviderListResponse } from "../../../services/provider";
import { clearToasts, toasts } from "../../../stores/toasts";
import { getServerModelState, resetServer as resetModels } from "../../../stores/models";

const { getApiClientMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
}));

vi.mock("../../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-add";

function provider(id: string, name: string): Provider {
  return { id, name, source: "env", env: [], options: {}, models: {} };
}

function listResponse(all: Provider[]): ProviderListResponse {
  return { all, default: {}, connected: [] };
}

function mockClient(initial: Provider[]) {
  const providers = [...initial];
  const client = {
    get: vi.fn(async (path: string) => {
      if (path === "/provider") return listResponse(providers);
      return undefined;
    }),
    patch: vi.fn(async () => undefined),
  };
  // Lets tests extend the catalog the mock /provider serves on re-fetch.
  (client as unknown as { __addProvider: (p: Provider) => void }).__addProvider = (p) => {
    providers.push(p);
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

let client: ReturnType<typeof mockClient>;

beforeEach(() => {
  resetModels(SERVER);
  clearToasts();
  getApiClientMock.mockReset();
  client = mockClient([provider("openai", "OpenAI")]);
});

afterEach(() => {
  resetModels(SERVER);
  clearToasts();
});

function Harness(props: { onClose?: () => void }) {
  const [open, setOpen] = createSignal(true);
  return (
    <Show when={open()}>
      <AddProviderDialog
        serverId={SERVER}
        onClose={() => {
          props.onClose?.();
          setOpen(false);
        }}
      />
    </Show>
  );
}

function renderDialog(onClose = vi.fn()) {
  render(() => <Harness onClose={onClose} />);
  return { onClose };
}

const FULL_PATCH = {
  provider: {
    myllm: {
      name: "My LLM",
      options: { baseURL: "https://myllm.example/v1", apiKey: "sk-test" },
    },
  },
};

describe("AddProviderDialog", () => {
  it("renders the fields with the global scope default and a disabled submit", () => {
    renderDialog();

    expect(screen.getByTestId("provider-add-id")).toBeInTheDocument();
    expect(screen.getByTestId("provider-add-name")).toBeInTheDocument();
    expect(screen.getByTestId("provider-add-baseurl")).toBeInTheDocument();
    expect(screen.getByTestId("provider-add-apikey")).toBeInTheDocument();
    expect(screen.getByTestId("provider-add-scope-global")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("provider-add-scope-project")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect((screen.getByTestId("provider-add-submit") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("provider-add-id-hint")).toHaveTextContent("Provider ID is required");
  });

  it("rejects a non-slug id with a hint and keeps submit disabled", () => {
    renderDialog();

    fireEvent.input(screen.getByTestId("provider-add-id"), {
      target: { value: "my provider" },
    });
    expect(screen.getByTestId("provider-add-id-hint")).toHaveTextContent(
      "Letters, digits, dashes and underscores",
    );
    expect((screen.getByTestId("provider-add-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("accepts a slug id and enables submit", () => {
    renderDialog();

    fireEvent.input(screen.getByTestId("provider-add-id"), {
      target: { value: "my-llm" },
    });
    expect(screen.queryByTestId("provider-add-id-hint")).not.toBeInTheDocument();
    expect((screen.getByTestId("provider-add-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("hints that a key without a base URL targets the built-in endpoint", () => {
    renderDialog();

    fireEvent.input(screen.getByTestId("provider-add-apikey"), {
      target: { value: "sk-test" },
    });
    expect(screen.getByTestId("provider-add-apikey-hint")).toHaveTextContent("Without a base URL");

    fireEvent.input(screen.getByTestId("provider-add-baseurl"), {
      target: { value: "https://myllm.example/v1" },
    });
    expect(screen.queryByTestId("provider-add-apikey-hint")).not.toBeInTheDocument();
  });

  it("adds globally: PATCHes /global/config, refreshes the catalog, toasts and closes", async () => {
    (client as unknown as { __addProvider: (p: Provider) => void }).__addProvider(
      provider("myllm", "My LLM"),
    );
    renderDialog();

    fireEvent.input(screen.getByTestId("provider-add-id"), { target: { value: "myllm" } });
    fireEvent.input(screen.getByTestId("provider-add-name"), { target: { value: "My LLM" } });
    fireEvent.input(screen.getByTestId("provider-add-baseurl"), {
      target: { value: "https://myllm.example/v1" },
    });
    fireEvent.input(screen.getByTestId("provider-add-apikey"), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByTestId("provider-add-submit"));

    await waitFor(() =>
      expect(client.patch).toHaveBeenCalledWith("/global/config", { body: FULL_PATCH }),
    );
    // The catalog is re-fetched and the new provider lands in the store.
    await waitFor(() =>
      expect(getServerModelState(SERVER).providers.map((p) => p.id)).toEqual(["openai", "myllm"]),
    );
    await waitFor(() =>
      expect(toasts.some((toast) => toast.message === "Provider added")).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("provider-add-dialog")).not.toBeInTheDocument(),
    );
  });

  it("adds to the project config when the project scope is picked", async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("provider-add-scope-project"));
    expect(screen.getByTestId("provider-add-scope-project")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.input(screen.getByTestId("provider-add-id"), { target: { value: "myllm" } });
    fireEvent.input(screen.getByTestId("provider-add-name"), { target: { value: "My LLM" } });
    fireEvent.input(screen.getByTestId("provider-add-baseurl"), {
      target: { value: "https://myllm.example/v1" },
    });
    fireEvent.input(screen.getByTestId("provider-add-apikey"), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByTestId("provider-add-submit"));

    // Project scope PATCHes /config — the active directory is injected by
    // the client layer, so no query is attached at the dialog level.
    await waitFor(() => expect(client.patch).toHaveBeenCalledWith("/config", { body: FULL_PATCH }));
  });

  it("keeps the dialog open with an inline error when the patch fails", async () => {
    client.patch.mockRejectedValueOnce(new Error("boom"));
    renderDialog();

    fireEvent.input(screen.getByTestId("provider-add-id"), { target: { value: "myllm" } });
    fireEvent.click(screen.getByTestId("provider-add-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-add-error")).toHaveTextContent(
        "Could not add the provider: boom",
      ),
    );
    expect(screen.getByTestId("provider-add-dialog")).toBeInTheDocument();
    // No catalog re-fetch happens on a failed add.
    expect(client.get).not.toHaveBeenCalled();
  });

  it("closes on cancel without patching", () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("provider-add-cancel"));
    expect(client.patch).not.toHaveBeenCalled();
  });
});
