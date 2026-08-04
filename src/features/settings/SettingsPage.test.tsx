// L2 tests for the settings page skeleton (TASK-M5-06): the header with
// the Back callback, the placeholder section nav (Providers active, the
// M9-04 placeholder), and the hosted provider keys section.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import SettingsPage from "./SettingsPage";
import type {
  Provider,
  ProviderAuthMethodsResponse,
  ProviderListResponse,
} from "../../services/provider";
import { resetServer as resetModels } from "../../stores/models";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-settings";

function provider(id: string, name: string): Provider {
  return { id, name, source: "env", env: [], options: {}, models: {} };
}

const AUTH_METHODS: ProviderAuthMethodsResponse = {
  openai: [{ type: "api", label: "API key" }],
};

beforeEach(() => {
  resetModels(SERVER);
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue({
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async (path: string) => {
      if (path === "/provider/auth") return AUTH_METHODS;
      if (path === "/provider")
        return {
          all: [provider("openai", "OpenAI")],
          default: {},
          connected: ["openai"],
        } satisfies ProviderListResponse;
      return [];
    }),
    put: vi.fn(async () => true),
    delete: vi.fn(async () => true),
  });
});

afterEach(() => {
  resetModels(SERVER);
});

describe("SettingsPage", () => {
  it("renders the header, section nav placeholder and provider keys section", async () => {
    render(() => <SettingsPage serverId={SERVER} onBack={vi.fn()} />);

    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByTestId("settings-section-providers")).toHaveTextContent("Providers");
    expect(screen.getByTestId("settings-section-more")).toHaveTextContent("More sections — M9-04");

    // The hosted providers section fetches and renders the keys panel.
    await screen.findByTestId("provider-key-row-openai");
    expect(screen.getByTestId("settings-back")).toBeInTheDocument();
  });

  it("invokes onBack from the header back button", () => {
    const onBack = vi.fn();
    render(() => <SettingsPage serverId={SERVER} onBack={onBack} />);

    fireEvent.click(screen.getByTestId("settings-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
