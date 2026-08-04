// L2 tests for the server navigation home (TASK-M1-06): list rendering and
// the empty state, servers-changed refresh, live health dots, the context
// menu flows (edit / reconnect / delete with confirmation) and the card
// menu button.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import ServerHome from "./ServerHome";
import type { ServerEntry } from "../../services/servers";

type ListenHandler = (event: { payload: unknown }) => void;
type Listen = (event: string, handler: ListenHandler) => Promise<() => void>;

const { invokeMock, listenMock } = vi.hoisted(() => {
  const listenMock = vi.fn<Listen>(() => Promise.resolve(() => {}));
  return { invokeMock: vi.fn(), listenMock };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

function server(overrides: Partial<ServerEntry>): ServerEntry {
  return {
    id: "srv-1",
    name: "Alpha",
    url: "http://localhost:14096",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Returns the listener registered for a Tauri event by the component. */
function handlerFor(event: string): (payload: unknown) => void {
  const call = listenMock.mock.calls.find(([name]) => name === event);
  if (!call) throw new Error(`no listener registered for "${event}"`);
  return (payload: unknown) => call[1]({ payload });
}

beforeEach(() => {
  window.__TAURI_INTERNALS__ = {};
  invokeMock.mockClear();
  // Default: an empty registry; tests override with mockResolvedValueOnce.
  invokeMock.mockImplementation(() => Promise.resolve([]));
  listenMock.mockClear();
});

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
});

describe("ServerHome list rendering", () => {
  it("shows the empty state when the registry has no servers", async () => {
    render(() => <ServerHome onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeInTheDocument());
    expect(screen.getByText("No servers yet")).toBeInTheDocument();
    expect(screen.getByTestId("add-first-server")).toBeInTheDocument();
  });

  it("renders one card per server with name, url and last connected time", async () => {
    const alpha = server({
      id: "srv-alpha",
      name: "Alpha",
      url: "http://localhost:14096",
      lastConnectedAt: Date.now() - 5 * 60_000,
    });
    const beta = server({
      id: "srv-beta",
      name: "Beta",
      url: "https://beta.example.com",
      lastConnectedAt: Date.now() - 2 * 3_600_000,
    });
    invokeMock.mockResolvedValueOnce([alpha, beta]);

    render(() => <ServerHome onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("server-card-srv-alpha")).toBeInTheDocument());

    const alphaCard = screen.getByTestId("server-card-srv-alpha");
    expect(alphaCard).toHaveTextContent("Alpha");
    expect(alphaCard).toHaveTextContent("http://localhost:14096");
    expect(within(alphaCard).getByTestId("last-connected")).toHaveTextContent(
      "Last connected 5m ago",
    );
    const betaCard = screen.getByTestId("server-card-srv-beta");
    expect(betaCard).toHaveTextContent("Beta");
    expect(betaCard).toHaveTextContent("https://beta.example.com");
    expect(within(betaCard).getByTestId("last-connected")).toHaveTextContent(
      "Last connected 2h ago",
    );
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });

  it("shows a Never connected label when the server was never reached", async () => {
    invokeMock.mockResolvedValueOnce([server({ id: "srv-alpha" })]);
    render(() => <ServerHome onSelect={vi.fn()} />);
    const card = await waitFor(() => screen.getByTestId("server-card-srv-alpha"));
    expect(within(card).getByTestId("last-connected")).toHaveTextContent("Never connected");
  });

  it("calls onSelect when a card is clicked", async () => {
    const alpha = server({ id: "srv-alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    const onSelect = vi.fn();
    render(() => <ServerHome onSelect={onSelect} />);
    const card = await waitFor(() => screen.getByTestId("server-card-srv-alpha"));
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(alpha);
  });

  it("refreshes the grid when servers-changed events arrive", async () => {
    render(() => <ServerHome onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeInTheDocument());

    handlerFor("servers-changed")([
      server({ id: "srv-new", name: "New", url: "http://localhost:14096" }),
    ]);
    await waitFor(() => expect(screen.getByTestId("server-card-srv-new")).toBeInTheDocument());
    expect(screen.getByTestId("server-card-srv-new")).toHaveTextContent("New");
  });
});

describe("ServerHome health events", () => {
  it("updates the status dot and meta from server-health events", async () => {
    invokeMock.mockResolvedValueOnce([server({ id: "srv-health", name: "Alpha" })]);
    render(() => <ServerHome onSelect={vi.fn()} />);
    const card = await waitFor(() => screen.getByTestId("server-card-srv-health"));
    const dot = within(card).getByTestId("status-dot");
    expect(dot).toHaveAttribute("data-status", "unknown");

    const health = handlerFor("server-health");
    health({
      serverId: "srv-health",
      healthy: true,
      version: "1.18.11",
      latencyMs: 12,
      status: "ok",
      failCount: 0,
    });
    await waitFor(() => expect(dot).toHaveAttribute("data-status", "ok"));
    expect(within(card).getByTestId("health-meta")).toHaveTextContent("1.18.11 · 12 ms");

    health({ serverId: "srv-health", healthy: false, status: "down", failCount: 3 });
    await waitFor(() => expect(dot).toHaveAttribute("data-status", "down"));
  });

  it("keeps per-server status independent", async () => {
    invokeMock.mockResolvedValueOnce([
      server({ id: "srv-a", name: "Alpha" }),
      server({ id: "srv-b", name: "Beta" }),
    ]);
    render(() => <ServerHome onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("server-card-srv-a")).toBeInTheDocument());

    const health = handlerFor("server-health");
    health({ serverId: "srv-a", healthy: true, status: "ok", failCount: 0 });
    health({ serverId: "srv-b", healthy: false, status: "down", failCount: 3 });
    await waitFor(() =>
      expect(
        within(screen.getByTestId("server-card-srv-a")).getByTestId("status-dot"),
      ).toHaveAttribute("data-status", "ok"),
    );
    expect(
      within(screen.getByTestId("server-card-srv-b")).getByTestId("status-dot"),
    ).toHaveAttribute("data-status", "down");
  });
});

describe("ServerHome context menu", () => {
  it("deletes a server through the context menu with confirmation", async () => {
    invokeMock.mockResolvedValueOnce([server({ id: "srv-del", name: "Alpha" })]);
    render(() => <ServerHome onSelect={vi.fn()} />);
    const card = await waitFor(() => screen.getByTestId("server-card-srv-del"));

    fireEvent.contextMenu(card);
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument(),
    );
    fireEvent.pointerUp(screen.getByRole("menuitem", { name: "Delete" }), {
      pointerType: "mouse",
    });
    await waitFor(() => expect(screen.getByTestId("delete-dialog")).toBeInTheDocument());

    invokeMock.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByTestId("confirm-delete"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("remove_server", { id: "srv-del" }),
    );

    handlerFor("servers-changed")([]);
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeInTheDocument());
  });

  it("keeps the dialog open and shows an error when deletion fails", async () => {
    invokeMock.mockResolvedValueOnce([server({ id: "srv-del-fail", name: "Alpha" })]);
    render(() => <ServerHome onSelect={vi.fn()} />);
    const card = await waitFor(() => screen.getByTestId("server-card-srv-del-fail"));

    fireEvent.contextMenu(card);
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument(),
    );
    fireEvent.pointerUp(screen.getByRole("menuitem", { name: "Delete" }), {
      pointerType: "mouse",
    });
    await waitFor(() => expect(screen.getByTestId("delete-dialog")).toBeInTheDocument());

    invokeMock.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByTestId("confirm-delete"));
    await waitFor(() => expect(screen.getByTestId("delete-error")).toHaveTextContent("boom"));
    expect(screen.getByTestId("delete-dialog")).toBeInTheDocument();
  });

  it("edits a server through the menu with the form prefilled", async () => {
    const entry = server({
      id: "srv-edit",
      name: "Alpha",
      username: "admin",
      password: "secret",
    });
    invokeMock.mockResolvedValueOnce([entry]);
    render(() => <ServerHome onSelect={vi.fn()} />);
    const card = await waitFor(() => screen.getByTestId("server-card-srv-edit"));

    fireEvent.contextMenu(card);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument());
    fireEvent.pointerUp(screen.getByRole("menuitem", { name: "Edit" }), {
      pointerType: "mouse",
    });
    await waitFor(() => expect(screen.getByTestId("add-server")).toBeInTheDocument());

    expect(screen.getByText("Edit server")).toBeInTheDocument();
    expect(screen.getByTestId("name-input")).toHaveValue("Alpha");
    expect(screen.getByTestId("url-input")).toHaveValue("http://localhost:14096");
    expect(screen.getByTestId("username-input")).toHaveValue("admin");

    fireEvent.input(screen.getByTestId("name-input"), { target: { value: "Alpha 2" } });
    invokeMock.mockResolvedValueOnce({ ...entry, name: "Alpha 2" });
    fireEvent.click(screen.getByTestId("save-server"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("update_server", {
        id: "srv-edit",
        entry: {
          name: "Alpha 2",
          url: "http://localhost:14096",
          username: "admin",
          password: "secret",
        },
      }),
    );
  });

  it("reconnects through the menu: probes and restarts the monitor", async () => {
    const entry = server({
      id: "srv-reconnect",
      name: "Alpha",
      username: "admin",
      password: "secret",
    });
    invokeMock.mockResolvedValueOnce([entry]);
    render(() => <ServerHome onSelect={vi.fn()} />);
    const card = await waitFor(() => screen.getByTestId("server-card-srv-reconnect"));

    invokeMock.mockResolvedValueOnce({
      serverId: "probe",
      healthy: true,
      version: "1.2.3",
      latencyMs: 9,
      status: "ok",
      failCount: 0,
    });
    invokeMock.mockResolvedValueOnce(undefined);
    fireEvent.contextMenu(card);
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Reconnect" })).toBeInTheDocument(),
    );
    fireEvent.pointerUp(screen.getByRole("menuitem", { name: "Reconnect" }), {
      pointerType: "mouse",
    });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("probe_server", {
        url: "http://localhost:14096",
        auth: { username: "admin", password: "secret" },
      }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("start_health_monitoring", {
        serverId: "srv-reconnect",
      }),
    );
    await waitFor(() =>
      expect(within(card).getByTestId("status-dot")).toHaveAttribute("data-status", "ok"),
    );
  });

  it("opens the same menu from the card button without selecting the card", async () => {
    invokeMock.mockResolvedValueOnce([server({ id: "srv-menu", name: "Alpha" })]);
    const onSelect = vi.fn();
    render(() => <ServerHome onSelect={onSelect} />);
    await waitFor(() => screen.getByTestId("server-card-srv-menu"));

    fireEvent.pointerDown(screen.getByTestId("server-menu-srv-menu"), {
      pointerType: "mouse",
    });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument());
    expect(screen.getByRole("menuitem", { name: "Reconnect" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("ServerHome Add Server wizard", () => {
  it("opens the wizard from the empty state and saves a new server", async () => {
    render(() => <ServerHome onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("add-first-server"));
    await waitFor(() => expect(screen.getByTestId("add-server")).toBeInTheDocument());

    fireEvent.input(screen.getByTestId("name-input"), { target: { value: "Local" } });
    fireEvent.input(screen.getByTestId("url-input"), {
      target: { value: "localhost:14096" },
    });
    invokeMock.mockResolvedValueOnce(
      server({ id: "srv-created", name: "Local", url: "http://localhost:14096" }),
    );
    fireEvent.click(screen.getByTestId("save-server"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("add_server", {
        entry: { name: "Local", url: "http://localhost:14096" },
      }),
    );
    await waitFor(() => expect(screen.getByTestId("server-home")).toBeInTheDocument());
  });

  it("returns from the wizard via the back button", async () => {
    render(() => <ServerHome onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("add-server-btn"));
    await waitFor(() => expect(screen.getByTestId("add-server")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("wizard-back"));
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeInTheDocument());
  });
});

describe("ServerHome re-auth flow (TASK-M1-09)", () => {
  const health = {
    serverId: "probe",
    healthy: true,
    version: "1.2.3",
    latencyMs: 9,
    status: "ok" as const,
    failCount: 0,
  };

  function renderWithServer(entry: ServerEntry): void {
    invokeMock.mockResolvedValueOnce([entry]);
    render(() => <ServerHome onSelect={vi.fn()} />);
  }

  async function openReauthDialog(entry: ServerEntry): Promise<void> {
    renderWithServer(entry);
    const card = await waitFor(() => screen.getByTestId(`server-card-${entry.id}`));
    fireEvent.contextMenu(card);
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Reconnect" })).toBeInTheDocument(),
    );
    invokeMock.mockRejectedValueOnce({
      status: 401,
      code: "http",
      message: '{"error":"unauthorized"}',
      retriable: false,
    });
    fireEvent.pointerUp(screen.getByRole("menuitem", { name: "Reconnect" }), {
      pointerType: "mouse",
    });
    await waitFor(() => expect(screen.getByTestId("reauth-dialog")).toBeInTheDocument());
  }

  it("opens the re-auth dialog prefilled when reconnect answers 401", async () => {
    const entry = server({ id: "srv-401", name: "Alpha", username: "admin", password: "secret" });
    await openReauthDialog(entry);

    expect(screen.getByTestId("reauth-username")).toHaveValue("admin");
    expect(screen.getByTestId("reauth-password")).toHaveValue("");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    // The failed probe must not start the health monitor.
    expect(invokeMock).not.toHaveBeenCalledWith("start_health_monitoring", expect.anything());
  });

  it("Save & Retry verifies via probe, persists and closes on success", async () => {
    const entry = server({
      id: "srv-401-ok",
      name: "Alpha",
      username: "admin",
      password: "secret",
    });
    await openReauthDialog(entry);

    invokeMock.mockResolvedValueOnce(health);
    invokeMock.mockResolvedValueOnce(server({ ...entry, password: "newpw" }));
    fireEvent.input(screen.getByTestId("reauth-password"), { target: { value: "newpw" } });
    fireEvent.click(screen.getByTestId("reauth-save"));

    // The new credentials are verified with a probe before persisting.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("probe_server", {
        url: "http://localhost:14096",
        auth: { username: "admin", password: "newpw" },
      }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("update_server", {
        id: "srv-401-ok",
        entry: {
          name: "Alpha",
          url: "http://localhost:14096",
          username: "admin",
          password: "newpw",
        },
      }),
    );
    // The dialog closes and the monitor restarts with the verified entry.
    await waitFor(() => expect(screen.queryByTestId("reauth-dialog")).toBeNull());
    expect(invokeMock).toHaveBeenCalledWith("start_health_monitoring", {
      serverId: "srv-401-ok",
    });
  });

  it("keeps the dialog open with an error when the retried probe fails", async () => {
    const entry = server({ id: "srv-401-fail", name: "Alpha", username: "admin" });
    await openReauthDialog(entry);

    invokeMock.mockRejectedValueOnce({
      status: 401,
      code: "http",
      message: '{"error":"unauthorized"}',
      retriable: false,
    });
    fireEvent.input(screen.getByTestId("reauth-password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByTestId("reauth-save"));

    await waitFor(() =>
      expect(screen.getByTestId("reauth-error")).toHaveTextContent("Authentication required"),
    );
    expect(screen.getByTestId("reauth-dialog")).toBeInTheDocument();
    // The rejected credentials must never reach the registry store.
    expect(invokeMock).not.toHaveBeenCalledWith("update_server", expect.anything());
  });

  it("Cancel closes the dialog without persisting anything", async () => {
    const entry = server({ id: "srv-401-cancel", name: "Alpha", username: "admin" });
    await openReauthDialog(entry);

    fireEvent.click(screen.getByTestId("reauth-cancel"));
    await waitFor(() => expect(screen.queryByTestId("reauth-dialog")).toBeNull());
    expect(invokeMock).not.toHaveBeenCalledWith("update_server", expect.anything());
  });
});

describe("ServerHome error banner (TASK-M1-09)", () => {
  it("shows a classified banner when the registry load fails", async () => {
    invokeMock.mockRejectedValueOnce({
      code: "network",
      message: "connection refused",
      retriable: true,
    });
    render(() => <ServerHome onSelect={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.getByTestId("error-banner-title")).toHaveTextContent("Cannot reach server");
    expect(screen.getByTestId("error-banner-detail")).toHaveTextContent("connection refused");
  });

  it("shows a classified banner when reconnect fails with a network error", async () => {
    const entry = server({ id: "srv-net", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([entry]);
    render(() => <ServerHome onSelect={vi.fn()} />);
    const card = await waitFor(() => screen.getByTestId("server-card-srv-net"));

    fireEvent.contextMenu(card);
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Reconnect" })).toBeInTheDocument(),
    );
    invokeMock.mockRejectedValueOnce({
      code: "timeout",
      message: "timed out after 5s",
      retriable: true,
    });
    fireEvent.pointerUp(screen.getByRole("menuitem", { name: "Reconnect" }), {
      pointerType: "mouse",
    });

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.getByTestId("error-banner-title")).toHaveTextContent("Request timed out");
    expect(screen.getByTestId("error-banner-detail")).toHaveTextContent("timed out after 5s");
    // A non-401 failure must not open the re-auth dialog.
    expect(screen.queryByTestId("reauth-dialog")).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith("start_health_monitoring", expect.anything());
  });

  it("dismisses the banner", async () => {
    invokeMock.mockRejectedValueOnce({
      code: "network",
      message: "connection refused",
      retriable: true,
    });
    render(() => <ServerHome onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("error-banner-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("error-banner")).toBeNull());
  });
});
