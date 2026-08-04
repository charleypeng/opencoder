// L2 tests for the desktop workspace shell (TASK-M1-08): mounting activates
// the server context, the rail renders one icon per server with health dots,
// servers switch via rail clicks and ⌘/Ctrl+1..9 keys with an active
// highlight, and exiting / unmounting clears the context.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import DesktopShell from "./DesktopShell";
import type { ServerEntry } from "../../services/servers";
import { getActiveServerId, registry, setActiveServer } from "../../stores/registry";

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
  setActiveServer(null);
});

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
  setActiveServer(null);
});

describe("DesktopShell workspace", () => {
  it("mounts the shell, activates the server context and shows placeholders", () => {
    const alpha = server({ id: "srv-alpha", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    expect(getActiveServerId()).toBe("srv-alpha");
    expect(screen.getByTestId("desktop-shell")).toBeInTheDocument();
    expect(screen.getByText("Chat sessions — M2")).toBeInTheDocument();
    expect(screen.getByText("Select a session — M2")).toBeInTheDocument();
  });

  it("renders a rail icon per server with initial and health dot", async () => {
    const alpha = server({ id: "srv-a1", name: "Alpha" });
    const beta = server({ id: "srv-b1", name: "Beta" });
    invokeMock.mockResolvedValueOnce([alpha, beta]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    const alphaItem = await waitFor(() => screen.getByTestId("rail-item-srv-a1"));
    expect(alphaItem).toHaveTextContent("A");
    const betaItem = screen.getByTestId("rail-item-srv-b1");
    expect(betaItem).toHaveTextContent("B");
    expect(within(alphaItem).getByTestId("rail-dot")).toHaveAttribute("data-status", "unknown");

    const health = handlerFor("server-health");
    health({ serverId: "srv-b1", healthy: false, status: "down", failCount: 3 });
    await waitFor(() =>
      expect(within(betaItem).getByTestId("rail-dot")).toHaveAttribute("data-status", "down"),
    );
  });

  it("switches the active server by clicking a rail icon", async () => {
    const alpha = server({ id: "srv-a2", name: "Alpha" });
    const beta = server({ id: "srv-b2", name: "Beta" });
    invokeMock.mockResolvedValueOnce([alpha, beta]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => screen.getByTestId("rail-item-srv-a2"));

    fireEvent.click(screen.getByTestId("rail-item-srv-b2"));
    expect(registry.activeServerId).toBe("srv-b2");
    expect(screen.getByTestId("rail-item-srv-b2")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("rail-item-srv-a2")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("sidebar-server-name")).toHaveTextContent("Beta");
  });

  it("switches servers with ⌘ and Ctrl number keys", async () => {
    const alpha = server({ id: "srv-a3", name: "Alpha" });
    const beta = server({ id: "srv-b3", name: "Beta" });
    const gamma = server({ id: "srv-c3", name: "Gamma" });
    invokeMock.mockResolvedValueOnce([alpha, beta, gamma]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => screen.getByTestId("rail-item-srv-c3"));

    fireEvent.keyDown(window, { key: "2", metaKey: true });
    expect(getActiveServerId()).toBe("srv-b3");
    fireEvent.keyDown(window, { key: "3", metaKey: true });
    expect(getActiveServerId()).toBe("srv-c3");
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(getActiveServerId()).toBe("srv-a3");
  });

  it("ignores number keys beyond the list and keys without a modifier", async () => {
    const alpha = server({ id: "srv-a4", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => screen.getByTestId("rail-item-srv-a4"));

    fireEvent.keyDown(window, { key: "5", metaKey: true });
    expect(getActiveServerId()).toBe("srv-a4");
    fireEvent.keyDown(window, { key: "1" });
    expect(getActiveServerId()).toBe("srv-a4");
  });

  it("refreshes the rail when servers-changed events arrive", async () => {
    const alpha = server({ id: "srv-a5", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => screen.getByTestId("rail-item-srv-a5"));

    handlerFor("servers-changed")([server({ id: "srv-new5", name: "New" })]);
    await waitFor(() => expect(screen.getByTestId("rail-item-srv-new5")).toBeInTheDocument());
  });

  it("Back to servers calls onExit", async () => {
    const alpha = server({ id: "srv-a6", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    const onExit = vi.fn();
    render(() => <DesktopShell server={alpha} onExit={onExit} />);
    await waitFor(() => screen.getByTestId("rail-item-srv-a6"));

    fireEvent.click(screen.getByTestId("back-to-servers"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("unmounting the shell clears the active server context", async () => {
    const alpha = server({ id: "srv-a7", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    const { unmount } = render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    expect(getActiveServerId()).toBe("srv-a7");

    unmount();
    expect(getActiveServerId()).toBeNull();
  });

  it("the rail + button exits back to the servers home", async () => {
    const alpha = server({ id: "srv-a8", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    const onExit = vi.fn();
    render(() => <DesktopShell server={alpha} onExit={onExit} />);
    await waitFor(() => screen.getByTestId("rail-add"));

    fireEvent.click(screen.getByTestId("rail-add"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
