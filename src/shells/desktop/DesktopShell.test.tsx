// L2 tests for the desktop workspace shell (TASK-M1-08): mounting activates
// the server context, the rail renders one icon per server with health dots,
// servers switch via rail clicks and ⌘/Ctrl+1..9 keys with an active
// highlight, and exiting / unmounting clears the context. TASK-M2-03 adds
// the project switcher in the sidebar and the per-directory SSE wiring:
// the stream is (re)built when the active server or directory changes, and
// switching projects re-syncs isolated session/message state. TASK-M2-04
// mounts the session list below the switcher; selecting a row opens the
// session's message list in the main pane (TASK-M2-06). TASK-M2-05 drives
// the "New session" button so the created session is entered in the store
// and opened in the message list.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import DesktopShell from "./DesktopShell";
import type { ServerEntry } from "../../services/servers";
import { getActiveServerId, registry, setActiveServer } from "../../stores/registry";
import { getServerProjectState, resetServer as resetProjects } from "../../stores/project";
import {
  applySessionList,
  getServerSessionState,
  sessions,
  resetServer as resetSessions,
} from "../../stores/session";
import { messages, resetServer as resetMessages, upsertMessage } from "../../stores/messages";
import type { components } from "../../services/api/schema.js";
import type { Project } from "../../services/project";
import type { Session } from "../../services/session";

type ListenHandler = (event: { payload: unknown }) => void;
type Listen = (event: string, handler: ListenHandler) => Promise<() => void>;

const { invokeMock, listenMock, sseSubscribeMock } = vi.hoisted(() => {
  const listenMock = vi.fn<Listen>(() => Promise.resolve(() => {}));
  return { invokeMock: vi.fn(), listenMock, sseSubscribeMock: vi.fn() };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("../../services/sse.js", () => ({ sseSubscribe: sseSubscribeMock }));

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

const DEMO_DIR = "/mock/projects/opencode-demo";
const LABS_DIR = "/mock/projects/opencode-labs";

function project(id: string, worktree: string, name: string): Project {
  return {
    id,
    worktree,
    name,
    time: { created: 1, updated: 1 },
    sandboxes: [],
  } as Project;
}

const DEMO_PROJECT = project("project-mock-1", DEMO_DIR, "opencode-demo");
const LABS_PROJECT = project("project-mock-2", LABS_DIR, "opencode-labs");

function session(id: string, directory: string, projectID = "project-mock-1"): Session {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title: id,
    version: "1.18.11",
    time: { created: 1, updated: 1 },
  } as Session;
}

function httpResponse(body: unknown) {
  return { status: 200, headers: {}, body, bodyText: undefined };
}

// Routes the Tauri invoke calls the services make: server registry + the
// dual-project REST fixture. `/project/current` and `/session` are
// directory-aware so switching projects returns isolated data.
function mockHttpRoutes(servers: ServerEntry[]) {
  invokeMock.mockImplementation((cmd: string, payload: unknown) => {
    if (cmd === "list_servers") return Promise.resolve(servers);
    if (cmd === "http_request") {
      const request = (
        payload as {
          request?: { method?: string; path?: string; query?: Record<string, string> };
        }
      ).request;
      const directory = request?.query?.directory;
      if (request?.path === "/project") {
        return Promise.resolve(httpResponse([DEMO_PROJECT, LABS_PROJECT]));
      }
      if (request?.path === "/project/current") {
        return Promise.resolve(httpResponse(directory === LABS_DIR ? LABS_PROJECT : DEMO_PROJECT));
      }
      if (request?.path === "/session") {
        if (request?.method === "POST") {
          return Promise.resolve(
            httpResponse({
              id: "sess_new_01",
              slug: "untitled",
              projectID: "project-mock-1",
              directory: DEMO_DIR,
              title: "",
              version: "1.18.11",
              time: { created: 1, updated: 1 },
            }),
          );
        }
        return Promise.resolve(
          httpResponse(
            directory === LABS_DIR
              ? [session("sess_labs_01", LABS_DIR, "project-mock-2")]
              : [session("sess_demo_01", DEMO_DIR)],
          ),
        );
      }
      if (request?.path === "/session/status") return Promise.resolve(httpResponse({}));
    }
    return Promise.resolve(httpResponse(undefined));
  });
}

let unsubscribes: (() => Promise<void>)[] = [];

/** Returns the most recent sseSubscribe call as [serverId, directory, handler]. */
function lastSseCall(): [string, string | undefined, unknown] {
  const calls = sseSubscribeMock.mock.calls as [string, string | undefined, unknown][];
  return calls[calls.length - 1];
}

beforeEach(() => {
  window.__TAURI_INTERNALS__ = {};
  invokeMock.mockClear();
  // Default: an empty registry; REST calls resolve to empty payloads so the
  // mount-time re-syncs stay clean; tests override with mockResolvedValueOnce
  // or mockHttpRoutes.
  invokeMock.mockImplementation((cmd: string) =>
    cmd === "http_request" ? Promise.resolve(httpResponse([])) : Promise.resolve([]),
  );
  listenMock.mockClear();
  setActiveServer(null);
  unsubscribes = [];
  sseSubscribeMock.mockClear();
  sseSubscribeMock.mockImplementation(async () => {
    const unsubscribe = vi.fn(async () => {});
    unsubscribes.push(unsubscribe);
    return unsubscribe;
  });
});

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
  setActiveServer(null);
  resetSessions("srv-sse");
  resetSessions("srv-switch");
  resetSessions("srv-rail-a");
  resetSessions("srv-rail-b");
  resetSessions("srv-sel");
  resetSessions("srv-new");
  resetSessions("srv-prompt");
  resetSessions("srv-noprompt");
  resetMessages("srv-switch");
  resetProjects("srv-sse");
  resetProjects("srv-switch");
  resetProjects("srv-rail-a");
  resetProjects("srv-rail-b");
});

describe("DesktopShell workspace", () => {
  it("mounts the shell, activates the server context and shows placeholders", () => {
    const alpha = server({ id: "srv-alpha", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    expect(getActiveServerId()).toBe("srv-alpha");
    expect(screen.getByTestId("desktop-shell")).toBeInTheDocument();
    // The sidebar's session list renders the (empty) store immediately.
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
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

describe("DesktopShell project switcher and SSE wiring (TASK-M2-03)", () => {
  it("mounts the project switcher and opens the server's per-directory stream", async () => {
    const alpha = server({ id: "srv-sse", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("project-switcher")).toBeInTheDocument());
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    expect(lastSseCall()[0]).toBe("srv-sse");
    expect(lastSseCall()[1]).toBe(DEMO_DIR);

    // The switcher's load seeded the store with both fixture projects.
    await waitFor(() =>
      expect(getServerProjectState("srv-sse").projects.map((p) => p.id)).toEqual([
        "project-mock-1",
        "project-mock-2",
      ]),
    );
    expect(screen.getByText("opencode-demo")).toBeInTheDocument();
    expect(screen.getByText(DEMO_DIR)).toBeInTheDocument();
  });

  it("switching projects rebuilds the stream, unsubscribes the old one and re-syncs isolated sessions", async () => {
    const alpha = server({ id: "srv-switch", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    // Demo context is synced; seed stale message state to prove it is dropped.
    await waitFor(() => expect(sessions["srv-switch"]?.order).toEqual(["sess_demo_01"]));
    const staleMessage: components["schemas"]["Message"] = {
      id: "m1",
      sessionID: "sess_demo_01",
      role: "user",
      time: { created: 1 },
    } as components["schemas"]["Message"];
    upsertMessage("srv-switch", "sess_demo_01", staleMessage);
    expect(messages["srv-switch"]).toBeDefined();

    const callsBefore = sseSubscribeMock.mock.calls.length;
    const previousUnsubscribe = unsubscribes[unsubscribes.length - 1];

    fireEvent.pointerDown(screen.getByTestId("project-switcher-trigger"), {
      pointerType: "mouse",
    });
    await waitFor(() =>
      expect(screen.getByTestId("project-switcher-item-project-mock-2")).toBeInTheDocument(),
    );
    fireEvent.pointerUp(screen.getByTestId("project-switcher-item-project-mock-2"), {
      pointerType: "mouse",
    });

    // Context switched in the project store.
    await waitFor(() => expect(getServerProjectState("srv-switch").current).toBe(LABS_DIR));
    // Old subscription torn down, new one opened for the labs directory.
    await waitFor(() => expect(sseSubscribeMock.mock.calls.length).toBe(callsBefore + 1));
    expect(lastSseCall()).toEqual(["srv-switch", LABS_DIR, expect.any(Function)]);
    expect(previousUnsubscribe).toHaveBeenCalled();
    // Re-sync replaced the session list; stale messages were dropped.
    await waitFor(() => expect(sessions["srv-switch"]?.order).toEqual(["sess_labs_01"]));
    expect(sessions["srv-switch"]?.sessions["sess_demo_01"]).toBeUndefined();
    expect(messages["srv-switch"]).toBeUndefined();
  });

  it("switching servers via the rail rebuilds the stream for the new server", async () => {
    const alpha = server({ id: "srv-rail-a", name: "Alpha" });
    const beta = server({ id: "srv-rail-b", name: "Beta" });
    mockHttpRoutes([alpha, beta]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    expect(lastSseCall()[0]).toBe("srv-rail-a");

    const previousUnsubscribe = unsubscribes[unsubscribes.length - 1];

    fireEvent.click(screen.getByTestId("rail-item-srv-rail-b"));
    // The new server's context resolves asynchronously (current project
    // fetch + store seed), so at least the last subscription must target
    // srv-b and the srv-a stream must have been torn down.
    await waitFor(() => expect(lastSseCall()[0]).toBe("srv-rail-b"));
    expect(lastSseCall()[1]).toBe(DEMO_DIR);
    expect(previousUnsubscribe).toHaveBeenCalled();
  });

  it("selecting a session row opens the message list in the main pane (TASK-M2-04)", async () => {
    const alpha = server({ id: "srv-sel", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    // The shell resets session state while (re)building the stream, so seed
    // the store afterwards — like a live SSE session.updated event.
    applySessionList("srv-sel", [session("sess_sel_01", DEMO_DIR)]);

    fireEvent.click(await screen.findByTestId("session-item-sess_sel_01"));
    expect(getServerSessionState("srv-sel").activeSessionId).toBe("sess_sel_01");
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
  });

  it("creating a new session opens the message list for it (TASK-M2-05)", async () => {
    const alpha = server({ id: "srv-new", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    // Wait for the mount-time re-sync to settle before creating, so the
    // full-list replacement can no longer overwrite the new session.
    await waitFor(() => expect(sessions["srv-new"]?.order).toEqual(["sess_demo_01"]));

    fireEvent.click(screen.getByTestId("new-session-button"));

    await waitFor(() =>
      expect(getServerSessionState("srv-new").activeSessionId).toBe("sess_new_01"),
    );
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(sessions["srv-new"]?.order).toContain("sess_new_01");
  });

  it("mounts the prompt box below the message list for the active session (TASK-M2-08)", async () => {
    const alpha = server({ id: "srv-prompt", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-prompt", [session("sess_prompt_01", DEMO_DIR)]);

    fireEvent.click(await screen.findByTestId("session-item-sess_prompt_01"));

    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(screen.getByTestId("prompt-box")).toBeInTheDocument();
    expect(screen.getByTestId("prompt-input")).toBeInTheDocument();
  });

  it("hides the prompt box while no session is active (TASK-M2-08)", async () => {
    const alpha = server({ id: "srv-noprompt", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    expect(screen.queryByTestId("prompt-box")).not.toBeInTheDocument();
    expect(screen.getByText("Select a session — M2")).toBeInTheDocument();
  });
});
