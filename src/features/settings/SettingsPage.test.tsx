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

  it("switches to the Shortcuts section and back to Providers", async () => {
    render(() => <SettingsPage serverId={SERVER} onBack={vi.fn()} />);
    await screen.findByTestId("provider-key-row-openai");

    const shortcutsNav = screen.getByTestId("settings-section-shortcuts");
    expect(shortcutsNav).toHaveAttribute("aria-selected", "false");
    fireEvent.click(shortcutsNav);
    expect(shortcutsNav).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("shortcuts-section")).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-row-quickOpen")).toBeInTheDocument();
    expect(screen.queryByTestId("provider-key-row-openai")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-section-providers"));
    expect(screen.getByTestId("settings-section-providers")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await screen.findByTestId("provider-key-row-openai");
    expect(screen.queryByTestId("shortcuts-section")).not.toBeInTheDocument();
  });

  it("switches to the Desktop section", () => {
    render(() => <SettingsPage serverId={SERVER} onBack={vi.fn()} />);

    const desktopNav = screen.getByTestId("settings-section-desktop");
    expect(desktopNav).toHaveAttribute("aria-selected", "false");
    fireEvent.click(desktopNav);
    expect(desktopNav).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("desktop-section")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-close-to-tray")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-shortcut-input")).toBeInTheDocument();
    expect(screen.queryByTestId("shortcuts-section")).not.toBeInTheDocument();
  });

  it("switches to the Notifications section", () => {
    render(() => <SettingsPage serverId={SERVER} onBack={vi.fn()} />);

    const notificationsNav = screen.getByTestId("settings-section-notifications");
    expect(notificationsNav).toHaveAttribute("aria-selected", "false");
    fireEvent.click(notificationsNav);
    expect(notificationsNav).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("notifications-section")).toBeInTheDocument();
    expect(screen.getByTestId("notifications-master")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-section")).not.toBeInTheDocument();
  });

  it("switches the app language from the Language section", () => {
    render(() => <SettingsPage serverId={SERVER} onBack={vi.fn()} />);

    const languageNav = screen.getByTestId("settings-section-language");
    expect(languageNav).toHaveAttribute("aria-selected", "false");
    fireEvent.click(languageNav);
    expect(languageNav).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("language-section")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByTestId("language-en")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("language-zh"));
    expect(localStorage.getItem("oc-lang")).toBe("zh-CN");
    expect(screen.getByTestId("language-zh")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("language-en")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "语言" })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("language-en"));
    expect(localStorage.getItem("oc-lang")).toBe("en");
    expect(screen.getByRole("heading", { name: "Language" })).toBeInTheDocument();
    localStorage.removeItem("oc-lang");
  });
});
