// L2 tests for the Servers settings section (TASK-M9-04): the saved
// server registry with live health status, the per-server notification
// switch (oc-notifications) and the per-server theme override quick-set
// (oc-theme-server).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import ServersSection from "./ServersSection";
import { applyServerHealth } from "../../stores/connection";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const SERVERS = [
  { id: "srv-a", name: "Alpha", url: "http://localhost:14096", createdAt: 1 },
  { id: "srv-b", name: "Beta", url: "http://10.0.0.2:14096", createdAt: 2 },
];

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) =>
    cmd === "list_servers" ? Promise.resolve(SERVERS) : Promise.resolve(undefined),
  );
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("ServersSection", () => {
  it("lists the saved servers with their live status", async () => {
    applyServerHealth({
      serverId: "srv-a",
      healthy: true,
      version: "1.18.11",
      latencyMs: 4,
      status: "ok",
      failCount: 0,
    });
    render(() => <ServersSection />);

    await waitFor(() => expect(screen.getByTestId("servers-row-srv-a")).toBeInTheDocument());
    expect(screen.getByTestId("servers-row-srv-b")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("servers-row-srv-a")).getByTestId("servers-status-dot"),
    ).toHaveAttribute("data-status", "ok");
    expect(
      within(screen.getByTestId("servers-row-srv-b")).getByTestId("servers-status-dot"),
    ).toHaveAttribute("data-status", "unknown");
    expect(screen.getByText("http://localhost:14096")).toBeInTheDocument();
  });

  it("toggles per-server notifications and persists the pref", async () => {
    render(() => <ServersSection />);
    await waitFor(() => expect(screen.getByTestId("servers-notify-srv-a")).toBeInTheDocument());

    const toggle = screen.getByTestId("servers-notify-srv-a");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(JSON.parse(localStorage.getItem("oc-notifications") ?? "{}")).toEqual({
      perServer: { "srv-a": false },
    });

    // The other server is untouched.
    expect(screen.getByTestId("servers-notify-srv-b")).toHaveAttribute("aria-checked", "true");
  });

  it("quick-sets and clears a per-server theme override", async () => {
    render(() => <ServersSection />);
    await waitFor(() => expect(screen.getByTestId("servers-theme-srv-a-dark")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("servers-theme-srv-a-dark"));
    expect(screen.getByTestId("servers-theme-srv-a-dark")).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(localStorage.getItem("oc-theme-server") ?? "{}")).toEqual({
      "srv-a": "dark",
    });

    fireEvent.click(screen.getByTestId("servers-theme-srv-a-follow"));
    expect(screen.getByTestId("servers-theme-srv-a-follow")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(JSON.parse(localStorage.getItem("oc-theme-server") ?? "{}")).toEqual({});
  });

  it("shows the empty state and surfaces load errors", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_servers" ? Promise.resolve([]) : Promise.resolve(undefined),
    );
    const view = render(() => <ServersSection />);
    await waitFor(() => expect(screen.getByTestId("servers-empty")).toBeInTheDocument());
    view.unmount();

    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_servers" ? Promise.reject(new Error("registry down")) : Promise.resolve(),
    );
    render(() => <ServersSection />);
    await waitFor(() => expect(screen.getByTestId("servers-load-error")).toBeInTheDocument());
    expect(screen.getByTestId("servers-load-error")).toHaveTextContent("registry down");
  });
});

describe("ServersSection default workspace (feat(default-workspace))", () => {
  const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));
  vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

  function entry(dir: string, name: string) {
    return {
      name,
      path: `${name}/`,
      absolute: `${dir === "/" ? "" : dir}/${name}`,
      type: "directory" as const,
      ignored: false,
    };
  }

  const LISTINGS: Record<string, string[]> = {
    "/": ["Volumes"],
    "/Volumes": ["data"],
    "/Volumes/data": ["project-a"],
  };

  beforeEach(() => {
    getApiClientMock.mockReset();
    const client = {
      get: vi.fn(async (url: string, opts?: { query?: { directory?: string } }) => {
        if (url === "/session") return [];
        const dir = opts?.query?.directory ?? "/";
        return (LISTINGS[dir] ?? []).map((name) => entry(dir, name));
      }),
      post: vi.fn(async () => ({})),
      patch: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    getApiClientMock.mockReturnValue(client);
  });

  it("shows the default workspace value (or Not set) per server", async () => {
    localStorage.setItem("oc-default-workspace:srv-a", JSON.stringify("/dev/opencode"));
    render(() => <ServersSection />);
    await waitFor(() => expect(screen.getByTestId("servers-row-srv-a")).toBeInTheDocument());

    const rowA = screen.getByTestId("servers-default-ws-srv-a");
    expect(within(rowA).getByTestId("servers-default-ws-value")).toHaveTextContent("/dev/opencode");
    const rowB = screen.getByTestId("servers-default-ws-srv-b");
    expect(within(rowB).getByTestId("servers-default-ws-value")).toHaveTextContent("Not set");
  });

  it("re-picks the default workspace through the picker and persists it", async () => {
    render(() => <ServersSection />);
    await waitFor(() => expect(screen.getByTestId("servers-row-srv-a")).toBeInTheDocument());

    fireEvent.click(
      within(screen.getByTestId("servers-default-ws-srv-a")).getByTestId(
        "servers-default-ws-change",
      ),
    );
    await waitFor(() => expect(screen.getByTestId("directory-picker-dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("directory-picker-item-Volumes"));
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-data")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("directory-picker-item-data"));
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-project-a")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("directory-picker-add"));

    await waitFor(() =>
      expect(screen.queryByTestId("directory-picker-dialog")).not.toBeInTheDocument(),
    );
    expect(readDefaultWorkspaceValue("srv-a")).toBe("/Volumes/data");
    expect(
      within(screen.getByTestId("servers-default-ws-srv-a")).getByTestId(
        "servers-default-ws-value",
      ),
    ).toHaveTextContent("/Volumes/data");
  });
});

function readDefaultWorkspaceValue(serverId: string): string | null {
  const raw = localStorage.getItem("oc-default-workspace:" + serverId);
  if (raw === null) return null;
  return JSON.parse(raw) as string;
}
