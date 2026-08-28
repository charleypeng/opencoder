// L2 tests for the settings center (TASK-M9-04): the section registry
// drives the sidebar nav, every section is reachable, the settings search
// filters the nav by title / hint / keywords (with a no-match state), the
// mobile variant renders the chip nav without the Back header, and the
// General / Servers sections work through the page (their own suites
// cover the details). About and Models are folded away
// (docs/ui-audit-2026-08 §7) — General and Config carry their content.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import SettingsPage from "./SettingsPage";
import type {
  Provider,
  ProviderAuthMethodsResponse,
  ProviderListResponse,
} from "../../services/provider";
import { resetServer as resetModels } from "../../stores/models";
import { applyServerHealth } from "../../stores/connection";

const { getApiClientMock, getAppVersionMock, invokeMock, openUrlMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  getAppVersionMock: vi.fn(),
  invokeMock: vi.fn(),
  openUrlMock: vi.fn(),
}));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));
vi.mock("../../services/updates.js", () => ({
  getAppVersion: getAppVersionMock,
  checkForUpdates: vi.fn(async () => null),
  installAndRelaunch: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

const SERVER = "srv-settings";

function provider(id: string, name: string): Provider {
  return { id, name, source: "env", env: [], options: {}, models: {} };
}

const AUTH_METHODS: ProviderAuthMethodsResponse = {
  openai: [{ type: "api", label: "API key" }],
};

const GITHUB_URL = "https://github.com/charleypeng/opencoder";

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
      if (path === "/config" || path === "/global/config")
        return { model: "gpt-5", default_agent: "build", share: "manual", autoupdate: true };
      if (path === "/config/providers") return { providers: [], default: {} };
      if (path === "/agent") return [{ name: "build" }, { name: "plan" }];
      return [];
    }),
    put: vi.fn(async () => true),
    delete: vi.fn(async () => true),
    patch: vi.fn(async () => ({ model: "gpt-5", share: "manual" })),
    post: vi.fn(async () => true),
  });
  getAppVersionMock.mockReset().mockResolvedValue(null);
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) =>
    cmd === "list_servers" ? Promise.resolve([]) : Promise.resolve(undefined),
  );
  openUrlMock.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
});

afterEach(() => {
  resetModels(SERVER);
  localStorage.clear();
});

describe("SettingsPage", () => {
  it("renders the header, the full sectioned nav and General active by default", () => {
    render(() => <SettingsPage serverId={SERVER} onClose={vi.fn()} />);

    expect(screen.getByTestId("settings-page")).toHaveAttribute("data-variant", "desktop");
    expect(screen.getByText("Settings")).toBeInTheDocument();
    const nav = screen.getByTestId("settings-sections");
    expect(nav).toHaveAttribute("data-kind", "sidebar");
    for (const id of [
      "general",
      "appearance",
      "language",
      "providers",
      "mcp",
      "servers",
      "shortcuts",
      "desktop",
      "pet",
      "notifications",
      "updates",
      "config",
      "diagnostics",
    ]) {
      expect(screen.getByTestId(`settings-section-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("settings-section-general")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("general-section")).toBeInTheDocument();
    expect(screen.getByTestId("settings-close")).toBeInTheDocument();
  });

  it("invokes onClose from the header close button", () => {
    const onClose = vi.fn();
    render(() => <SettingsPage serverId={SERVER} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("settings-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the close button icon-only with an accessible label", () => {
    render(() => <SettingsPage serverId={SERVER} onClose={vi.fn()} />);

    const button = screen.getByTestId("settings-close");
    expect(button).toHaveTextContent("✕");
    expect(button.textContent?.replace(/\s/g, "")).toBe("✕");
    // The visible text is gone, so the accessible name must survive.
    expect(button.getAttribute("aria-label")?.length ?? 0).toBeGreaterThan(0);
  });

  it("reaches every section from the nav", () => {
    render(() => <SettingsPage serverId={SERVER} onClose={vi.fn()} />);

    const cases: Array<[string, string]> = [
      ["appearance", "appearance-section"],
      ["language", "language-section"],
      ["mcp", "mcp-section"],
      ["servers", "servers-section"],
      ["shortcuts", "shortcuts-section"],
      ["desktop", "desktop-section"],
      ["pet", "pet-section"],
      ["notifications", "notifications-section"],
      ["updates", "updates-section"],
      ["config", "config-section"],
      ["diagnostics", "diagnostics-section"],
    ];
    for (const [sectionId, sectionTestId] of cases) {
      const navButton = screen.getByTestId(`settings-section-${sectionId}`);
      expect(navButton).not.toHaveAttribute("aria-current");
      fireEvent.click(navButton);
      expect(navButton).toHaveAttribute("aria-current", "true");
      expect(screen.getByTestId(sectionTestId)).toBeInTheDocument();
      expect(screen.queryByTestId("general-section")).not.toBeInTheDocument();
    }
  });

  it("hosts the providers section (API keys) and switches back", async () => {
    render(() => <SettingsPage serverId={SERVER} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("settings-section-providers"));
    await screen.findByTestId("provider-key-row-openai");
    expect(screen.getByTestId("settings-section-providers")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.queryByTestId("general-section")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-section-general"));
    expect(screen.getByTestId("general-section")).toBeInTheDocument();
    expect(screen.queryByTestId("provider-key-row-openai")).not.toBeInTheDocument();
  });

  it("filters the nav by title / hint / keywords and shows the no-match state", () => {
    render(() => <SettingsPage serverId={SERVER} onClose={vi.fn()} />);

    const search = screen.getByTestId("settings-search");
    fireEvent.input(search, { target: { value: "accent" } });
    // "accent" matches the Appearance hint and keywords only.
    expect(screen.getByTestId("settings-section-appearance")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-section-general")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-section-providers")).not.toBeInTheDocument();

    fireEvent.input(search, { target: { value: "zzz" } });
    expect(screen.getByTestId("settings-search-empty")).toBeInTheDocument();

    fireEvent.input(search, { target: { value: "" } });
    expect(screen.getByTestId("settings-section-general")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-search-empty")).not.toBeInTheDocument();
  });

  it("renders grouped desktop nav headers and hides groups without matches", () => {
    render(() => <SettingsPage serverId={SERVER} onClose={vi.fn()} />);

    // Four group headers on the desktop sidebar, sections nested inside.
    for (const group of ["app", "connections", "system", "advanced"]) {
      expect(screen.getByTestId(`settings-group-${group}`)).toBeInTheDocument();
    }
    expect(screen.getByText("Connections")).toBeInTheDocument();

    // Searching narrows to one group: the other headers disappear.
    fireEvent.input(screen.getByTestId("settings-search"), { target: { value: "accent" } });
    expect(screen.getByTestId("settings-group-app")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-group-connections")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-group-system")).not.toBeInTheDocument();
  });

  it("keeps the active section rendered while it is filtered out", () => {
    render(() => <SettingsPage serverId={SERVER} onClose={vi.fn()} />);

    fireEvent.input(screen.getByTestId("settings-search"), { target: { value: "zzz" } });
    expect(screen.getByTestId("settings-search-empty")).toBeInTheDocument();
    expect(screen.getByTestId("general-section")).toBeInTheDocument();
  });

  it("resets settings from the General section (two-step confirm)", () => {
    localStorage.setItem("oc-foo", "1");
    render(() => <SettingsPage serverId={SERVER} onClose={vi.fn()} />);

    const reset = screen.getByTestId("general-reset");
    fireEvent.click(reset);
    expect(localStorage.getItem("oc-foo")).toBe("1");
    fireEvent.click(reset);
    expect(localStorage.getItem("oc-foo")).toBeNull();
  });

  it("renders the General section with versions and links (About folded in)", async () => {
    getAppVersionMock.mockResolvedValue("1.0.0");
    applyServerHealth({
      serverId: SERVER,
      healthy: true,
      version: "1.18.11",
      latencyMs: 4,
      status: "ok",
      failCount: 0,
    });
    render(() => <SettingsPage serverId={SERVER} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("general-version")).toHaveTextContent("1.0.0"));
    expect(screen.getByTestId("general-server-version")).toHaveTextContent("1.18.11");
    expect(screen.getByTestId("general-license")).toHaveTextContent("MIT License");

    fireEvent.click(screen.getByTestId("general-github"));
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(GITHUB_URL));
  });

  it("lists servers with notification and theme-override toggles", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_servers"
        ? Promise.resolve([
            { id: "srv-a", name: "Alpha", url: "http://localhost:14096", createdAt: 1 },
          ])
        : Promise.resolve(undefined),
    );
    render(() => <SettingsPage serverId={SERVER} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("settings-section-servers"));
    await screen.findByTestId("servers-row-srv-a");

    fireEvent.click(screen.getByTestId("servers-notify-srv-a"));
    expect(JSON.parse(localStorage.getItem("oc-notifications") ?? "{}")).toEqual({
      perServer: { "srv-a": false },
    });

    fireEvent.click(screen.getByTestId("servers-theme-srv-a-dark"));
    expect(JSON.parse(localStorage.getItem("oc-theme-server") ?? "{}")).toEqual({
      "srv-a": "dark",
    });
  });

  it("renders the mobile variant with the chip nav and no Back header", () => {
    render(() => <SettingsPage serverId={SERVER} variant="mobile" />);

    expect(screen.getByTestId("settings-page")).toHaveAttribute("data-variant", "mobile");
    expect(screen.queryByTestId("settings-close")).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-sections")).toHaveAttribute("data-kind", "chips");

    fireEvent.click(screen.getByTestId("settings-section-config"));
    expect(screen.getByTestId("settings-section-config")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("config-section")).toBeInTheDocument();
  });

  it("switches the app language from the Language section", () => {
    render(() => <SettingsPage serverId={SERVER} onClose={vi.fn()} />);

    const languageNav = screen.getByTestId("settings-section-language");
    expect(languageNav).not.toHaveAttribute("aria-current");
    fireEvent.click(languageNav);
    expect(languageNav).toHaveAttribute("aria-current", "true");
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
  });
});
