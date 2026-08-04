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
// and opened in the message list. TASK-M4-04: the provisional ⌘/Ctrl+P
// hook opens the Quick open dialog (guarded while typing in text controls)
// and a picked file jumps Main to Files.

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
import { applyTodos, resetServer as resetTodos } from "../../stores/todos";
import { openTab, resetServer as resetViewer, viewer } from "../../stores/viewer";
import { resetServer as resetDiffs } from "../../stores/diff";
import type { components } from "../../services/api/schema.js";
import type { Project } from "../../services/project";
import type { Session } from "../../services/session";
import { readRecentFiles } from "../../features/files/recentFiles";

type ListenHandler = (event: { payload: unknown }) => void;
type Listen = (event: string, handler: ListenHandler) => Promise<() => void>;

const { invokeMock, listenMock, sseSubscribeMock } = vi.hoisted(() => {
  const listenMock = vi.fn<Listen>(() => Promise.resolve(() => {}));
  return { invokeMock: vi.fn(), listenMock, sseSubscribeMock: vi.fn() };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("../../services/sse.js", () => ({ sseSubscribe: sseSubscribeMock }));
// The Files viewer highlights through Shiki; a stub keeps the shell tests
// free of language-pack loading (the viewer tests cover the real contract).
vi.mock("../../features/messages/markdown/highlighter.js", () => ({
  getHighlighter: vi.fn(),
  highlightCode: vi.fn(async (code: string) => `<pre data-testid="hl">${code}</pre>`),
}));

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

/** /session/{id}/diff payload with one patched file and one stats-only file. */
const DIFF_FIXTURE = [
  {
    file: "src/auth/login.ts",
    patch:
      '--- a/src/auth/login.ts\n+++ b/src/auth/login.ts\n@@ -1,3 +1,4 @@\n import { auth } from "./api";\n const a = 1;\n-const gone = 2;\n+export const added = 2;\n',
    additions: 1,
    deletions: 1,
    status: "modified" as const,
  },
  { file: "src/auth/token.ts", additions: 8, deletions: 0, status: "added" as const },
];

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
      if (request?.path === "/file") {
        return Promise.resolve(
          httpResponse([
            {
              name: "README.md",
              path: "README.md",
              type: "file",
              absolute: "/mock/projects/opencode-demo/README.md",
              ignored: false,
            },
            {
              name: "src",
              path: "src",
              type: "directory",
              absolute: "/mock/projects/opencode-demo/src",
              ignored: false,
            },
          ]),
        );
      }
      if (request?.path === "/file/status") return Promise.resolve(httpResponse([]));
      if (request?.path === "/find") {
        return Promise.resolve(
          httpResponse([
            {
              path: { text: "src/app.ts" },
              lines: { text: 'export const greeting = "hello";' },
              line_number: 3,
              absolute_offset: 24,
              submatches: [{ match: { text: "greeting" }, start: 18, end: 26 }],
            },
            {
              path: { text: "src/app.ts" },
              lines: { text: "console.log(greeting);" },
              line_number: 8,
              absolute_offset: 88,
              submatches: [{ match: { text: "greeting" }, start: 13, end: 21 }],
            },
            {
              path: { text: "README.md" },
              lines: { text: "# Demo project" },
              line_number: 1,
              absolute_offset: 0,
              submatches: [{ match: { text: "Demo" }, start: 2, end: 6 }],
            },
          ]),
        );
      }
      if (request?.path === "/file/content") {
        return Promise.resolve(
          httpResponse(
            request?.query?.path === "README.md"
              ? { type: "text", content: "# Demo project\n", mimeType: "text/markdown" }
              : { type: "text", content: "const a = 1;\n", mimeType: "text/typescript" },
          ),
        );
      }
      if (/^\/session\/.+\/diff$/.test(request?.path ?? "")) {
        return Promise.resolve(httpResponse(DIFF_FIXTURE));
      }
      if (request?.path === "/session/sess_diff_01/message") {
        return Promise.resolve(
          httpResponse([
            {
              info: {
                id: "msg_02",
                sessionID: "ses_diff_01",
                role: "user",
                time: { created: 1, updated: 1 },
              },
              parts: [
                {
                  id: "prt_1",
                  sessionID: "ses_diff_01",
                  messageID: "msg_02",
                  type: "text",
                  text: "hello",
                },
              ],
            },
          ]),
        );
      }
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
  resetTodos("srv-todos");
  resetTodos("srv-todos-live");
  resetProjects("srv-sse");
  resetProjects("srv-switch");
  resetProjects("srv-rail-a");
  resetProjects("srv-rail-b");
  resetViewer("srv-m4view");
  resetSessions("srv-m4quick");
  resetProjects("srv-m4quick");
  resetViewer("srv-m4quick");
  resetMessages("srv-m4quick");
  resetTodos("srv-m4quick");
  resetViewer("srv-m4search");
  resetSessions("srv-m4search");
  resetProjects("srv-m4search");
  resetDiffs("srv-m4diff");
  resetMessages("srv-m4search");
  resetTodos("srv-m4search");
  localStorage.removeItem("oc-recent-files:srv-m4quick");
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

  it("switches the sidebar between Sessions and Files (TASK-M4-02)", async () => {
    const alpha = server({ id: "srv-files", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // Sessions is the default view.
    expect(screen.getByTestId("sidebar-view-sessions")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
    expect(screen.queryByTestId("file-tree")).not.toBeInTheDocument();

    // The Files view mounts the tree (empty workspace renders the empty state).
    fireEvent.click(screen.getByTestId("sidebar-view-files"));
    expect(screen.getByTestId("sidebar-view-files")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
    expect(screen.queryByTestId("session-list")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("file-tree-empty")).toBeInTheDocument());

    // Back to sessions.
    fireEvent.click(screen.getByTestId("sidebar-view-sessions"));
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
    expect(screen.queryByTestId("file-tree")).not.toBeInTheDocument();
  });
});

describe("DesktopShell todo drawer (TASK-M3-07)", () => {
  it("toggles the drawer from the chat header and closes via Esc / backdrop / close button", async () => {
    const alpha = server({ id: "srv-todos", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-todos", [session("sess_todo_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("session-item-sess_todo_01"));

    // The chat header carries the session title + the todo toggle.
    expect(screen.getByTestId("chat-session-title")).toBeInTheDocument();
    expect(screen.getByTestId("todo-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("todo-drawer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("todo-toggle"));
    expect(screen.getByTestId("todo-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("todo-panel")).toBeInTheDocument();
    expect(screen.getByTestId("todo-toggle")).toHaveAttribute("aria-pressed", "true");

    // Esc closes the drawer.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("todo-drawer")).not.toBeInTheDocument());

    // Backdrop click closes the drawer.
    fireEvent.click(screen.getByTestId("todo-toggle"));
    fireEvent.click(screen.getByTestId("todo-drawer-backdrop"));
    await waitFor(() => expect(screen.queryByTestId("todo-drawer")).not.toBeInTheDocument());

    // The close button closes the drawer.
    fireEvent.click(screen.getByTestId("todo-toggle"));
    fireEvent.click(screen.getByTestId("todo-drawer-close"));
    await waitFor(() => expect(screen.queryByTestId("todo-drawer")).not.toBeInTheDocument());
  });

  it("renders the todo list live from the store inside the drawer", async () => {
    const alpha = server({ id: "srv-todos-live", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-todos-live", [session("sess_todo_02", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("session-item-sess_todo_02"));

    // Seed the store like a todo.updated SSE event.
    applyTodos("srv-todos-live", "sess_todo_02", [
      { content: "Explore the repo", status: "in_progress", priority: "high" },
      { content: "Summarize the code", status: "pending", priority: "medium" },
    ]);
    fireEvent.click(screen.getByTestId("todo-toggle"));

    const items = await screen.findAllByTestId("todo-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-status", "in_progress");
    expect(screen.getByText("Explore the repo")).toBeInTheDocument();
    expect(screen.getByText("Summarize the code")).toBeInTheDocument();

    // A store mutation (live event) updates the open panel immediately.
    applyTodos("srv-todos-live", "sess_todo_02", [
      { content: "Explore the repo", status: "completed", priority: "high" },
      { content: "Summarize the code", status: "in_progress", priority: "medium" },
    ]);
    await waitFor(() => expect(screen.getByText("Explore the repo")).toHaveClass("line-through"));
    expect(screen.getByText("Explore the repo")).toHaveClass("text-fg-faint");
  });
});

describe("DesktopShell main view tabs (TASK-M4-03)", () => {
  it("renders the Chat|Files tab bar with Chat selected and switches to the empty viewer", async () => {
    const alpha = server({ id: "srv-m4view", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    expect(screen.getByTestId("main-tab-chat")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("main-tab-files")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Select a session — M2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("main-tab-files"));
    expect(screen.getByTestId("main-tab-files")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("file-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("viewer-empty")).toBeInTheDocument();
    expect(screen.queryByText("Select a session — M2")).not.toBeInTheDocument();

    // Back to Chat restores the chat pane.
    fireEvent.click(screen.getByTestId("main-tab-chat"));
    expect(screen.getByTestId("main-tab-chat")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Select a session — M2")).toBeInTheDocument();
  });

  it("switching projects clears the viewer tabs and active path (TASK-M4-03)", async () => {
    const alpha = server({ id: "srv-m4view", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // Seed viewer state the way an open file would (store-level; the shell
    // drops it when the context rebuilds).
    openTab("srv-m4view", "README.md");
    expect(viewer["srv-m4view"]?.tabs.map((tab) => tab.path)).toEqual(["README.md"]);
    expect(viewer["srv-m4view"]?.activePath).toBe("README.md");

    fireEvent.pointerDown(screen.getByTestId("project-switcher-trigger"), {
      pointerType: "mouse",
    });
    await waitFor(() =>
      expect(screen.getByTestId("project-switcher-item-project-mock-2")).toBeInTheDocument(),
    );
    fireEvent.pointerUp(screen.getByTestId("project-switcher-item-project-mock-2"), {
      pointerType: "mouse",
    });

    // The context rebuild cleared the previous directory's tabs.
    await waitFor(() => expect(getServerProjectState("srv-m4view").current).toBe(LABS_DIR));
    expect(viewer["srv-m4view"]).toBeUndefined();
  });

  it("a sidebar tree click opens the file tab in the Main Files view and switches to it", async () => {
    const alpha = server({ id: "srv-m4view", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // Open the sidebar Files tree and click the README row.
    fireEvent.click(screen.getByTestId("sidebar-view-files"));
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("file-row-README.md"));

    // Main switched to Files with the opened tab; the content is fetched
    // and highlighted through the stubbed highlighter.
    expect(screen.getByTestId("main-tab-files")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("viewer-tab-README.md")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("viewer-code")).toHaveTextContent("# Demo project"),
    );
    expect(viewer["srv-m4view"]?.tabs.map((tab) => tab.path)).toEqual(["README.md"]);

    // A second click re-activates the existing tab without a duplicate.
    fireEvent.click(screen.getByTestId("file-row-README.md"));
    expect(viewer["srv-m4view"]?.tabs).toHaveLength(1);
  });
});

describe("DesktopShell quick open (TASK-M4-04)", () => {
  it("⌘P opens the dialog and picking a recent file jumps Main to Files", async () => {
    const alpha = server({ id: "srv-m4quick", name: "Alpha" });
    mockHttpRoutes([alpha]);
    localStorage.setItem("oc-recent-files:srv-m4quick", JSON.stringify(["README.md"]));
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // ⌘P opens the search dialog with the input focused.
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    expect(screen.getByTestId("quick-open-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("quick-open-input")).toHaveFocus();
    // The empty-query view lists the seeded recent file.
    expect(screen.getByTestId("quick-open-item-README.md")).toBeInTheDocument();

    // Picking it opens the viewer tab and switches Main to Files, like a
    // sidebar tree click; the content fetch lands through the stub.
    fireEvent.click(screen.getByTestId("quick-open-item-README.md"));
    expect(screen.queryByTestId("quick-open-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("main-tab-files")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("viewer-tab-README.md")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("viewer-code")).toHaveTextContent("# Demo project"),
    );
    expect(viewer["srv-m4quick"]?.tabs.map((tab) => tab.path)).toEqual(["README.md"]);
    expect(readRecentFiles("srv-m4quick")).toEqual(["README.md"]);
  });

  it("Ctrl+P works too and Esc closes the dialog", async () => {
    const alpha = server({ id: "srv-m4quick", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(screen.getByTestId("quick-open-dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("quick-open-input"), { key: "Escape" });
    expect(screen.queryByTestId("quick-open-dialog")).not.toBeInTheDocument();
  });

  it("ignores ⌘P while typing in a text control", async () => {
    const alpha = server({ id: "srv-m4quick", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m4quick", [session("sess_qp_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("session-item-sess_qp_01"));

    // A shortcut fired while the composer input is focused must not open
    // the dialog (browsers reserve ⌘P for print there).
    fireEvent.keyDown(screen.getByTestId("prompt-input"), { key: "p", metaKey: true });
    expect(screen.queryByTestId("quick-open-dialog")).not.toBeInTheDocument();

    // The same shortcut on the window (no text target) opens the dialog.
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    expect(screen.getByTestId("quick-open-dialog")).toBeInTheDocument();
  });
});

describe("DesktopShell full-text search (TASK-M4-05)", () => {
  it("⌘⇧F switches Main to Files and opens the search panel; a hit opens the tab and targets its line", async () => {
    const alpha = server({ id: "srv-m4search", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // ⌘⇧F from the chat view jumps to Files + search mode.
    fireEvent.keyDown(window, { key: "F", shiftKey: true, metaKey: true });
    expect(screen.getByTestId("main-tab-files")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("files-search-pane")).toHaveAttribute("data-visible", "true");
    expect(screen.getByTestId("files-viewer-pane")).toHaveAttribute("data-visible", "false");
    expect(screen.getByTestId("search-input")).toBeInTheDocument();

    fireEvent.input(screen.getByTestId("search-input"), { target: { value: "greeting" } });
    await waitFor(() => expect(screen.getByTestId("search-hit-src/app.ts-3")).toBeInTheDocument());
    // Grouped by file with both hits in one group.
    expect(screen.getByTestId("search-group-src/app.ts")).toBeInTheDocument();
    expect(screen.getByTestId("search-group-README.md")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("search-hit-src/app.ts-3"));
    expect(viewer["srv-m4search"]?.tabs.map((tab) => tab.path)).toEqual(["src/app.ts"]);
    expect(viewer["srv-m4search"]?.activePath).toBe("src/app.ts");
    expect(viewer["srv-m4search"]?.activeLine).toEqual({ path: "src/app.ts", line: 3 });
    // The hit returns to the viewer mode; the panel stays mounted.
    await waitFor(() =>
      expect(screen.getByTestId("files-viewer-pane")).toHaveAttribute("data-visible", "true"),
    );
    expect(screen.getByTestId("search-input")).toBeInTheDocument();
  });

  it("repeated ⌘⇧F cycles between the search panel and the viewer", async () => {
    const alpha = server({ id: "srv-m4search", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: "F", shiftKey: true, ctrlKey: true });
    expect(screen.getByTestId("files-search-pane")).toHaveAttribute("data-visible", "true");

    fireEvent.keyDown(window, { key: "f", shiftKey: true, ctrlKey: true });
    expect(screen.getByTestId("files-viewer-pane")).toHaveAttribute("data-visible", "true");
    expect(screen.getByTestId("files-search-pane")).toHaveAttribute("data-visible", "false");
  });

  it("the search toggle button in the Files tab switches modes and shows its state", async () => {
    const alpha = server({ id: "srv-m4search", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // The toggle only exists while the Files tab is active.
    expect(screen.queryByTestId("files-search-toggle")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("main-tab-files"));
    const button = screen.getByTestId("files-search-toggle");
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("files-search-pane")).toHaveAttribute("data-visible", "true");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("files-viewer-pane")).toHaveAttribute("data-visible", "true");
  });

  it("ignores ⌘⇧F while typing in a text control", async () => {
    const alpha = server({ id: "srv-m4search", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m4search", [session("sess_sf_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("session-item-sess_sf_01"));

    fireEvent.keyDown(screen.getByTestId("prompt-input"), {
      key: "F",
      shiftKey: true,
      metaKey: true,
    });
    expect(screen.getByTestId("main-tab-chat")).toHaveAttribute("aria-selected", "true");

    // The same shortcut on the window (no text target) opens search.
    fireEvent.keyDown(window, { key: "F", shiftKey: true, metaKey: true });
    expect(screen.getByTestId("files-search-pane")).toHaveAttribute("data-visible", "true");
  });
});

describe("DesktopShell session diff view (TASK-M4-07)", () => {
  it("⌘D opens the diff view for the active session and Back returns to chat", async () => {
    const alpha = server({ id: "srv-m4diff", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m4diff", [session("sess_diff_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("session-item-sess_diff_01"));

    // ⌘D opens the diff view with its own header (no Chat|Files tab bar).
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    expect(screen.getByTestId("session-diff-view")).toBeInTheDocument();
    expect(screen.getByText("Session diff")).toBeInTheDocument();
    expect(screen.queryByTestId("main-tab-chat")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByTestId("diff-file-header").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("src/auth/login.ts")).toBeInTheDocument();
    // No message filter chip for a whole-session diff.
    expect(screen.queryByTestId("diff-message-filter")).not.toBeInTheDocument();

    // Back returns to the chat view.
    fireEvent.click(screen.getByTestId("diff-back"));
    expect(screen.queryByTestId("session-diff-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("main-tab-chat")).toBeInTheDocument();
  });

  it("⌘D toggles back to chat and is ignored while typing in a text control", async () => {
    const alpha = server({ id: "srv-m4diff", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m4diff", [session("sess_diff_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("session-item-sess_diff_01"));

    // Guarded while typing in the prompt input.
    fireEvent.keyDown(screen.getByTestId("prompt-input"), { key: "d", metaKey: true });
    expect(screen.queryByTestId("session-diff-view")).not.toBeInTheDocument();

    // Open, then a second ⌘D toggles back to chat.
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    expect(screen.getByTestId("session-diff-view")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "D", ctrlKey: true });
    expect(screen.queryByTestId("session-diff-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("main-tab-chat")).toBeInTheDocument();
  });

  it("message View diff opens the filtered diff and the chip clears it", async () => {
    const alpha = server({ id: "srv-m4diff", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m4diff", [session("sess_diff_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("session-item-sess_diff_01"));
    await waitFor(() => expect(screen.getByTestId("message-msg_02")).toBeInTheDocument());

    // Message menu → View diff jumps Main to the diff view filtered to the
    // message id (the request carries the messageID query).
    const invokeForDiff = invokeMock.mock.calls.filter(
      (call) =>
        call[0] === "http_request" && /^\/session\/.+\/diff$/.test(call[1].request?.path ?? ""),
    );
    expect(invokeForDiff).toHaveLength(0);

    fireEvent.pointerDown(screen.getByTestId("message-actions"), { pointerType: "mouse" });
    const item = await screen.findByTestId("message-action-view-diff");
    expect(item).not.toBeDisabled();
    fireEvent.pointerUp(item, { pointerType: "mouse" });

    expect(screen.getByTestId("session-diff-view")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("diff-message-filter")).toBeInTheDocument());
    expect(screen.getByTestId("diff-message-filter")).toHaveTextContent("Message msg_02");
    await waitFor(() =>
      expect(screen.getAllByTestId("diff-file-header").length).toBeGreaterThan(0),
    );
    const diffCalls = invokeMock.mock.calls.filter(
      (call) =>
        call[0] === "http_request" && /^\/session\/.+\/diff$/.test(call[1].request?.path ?? ""),
    );
    expect(diffCalls[0][1].request.query.messageID).toBe("msg_02");

    // The chip's × clears the filter (whole-session diff, chip gone).
    fireEvent.click(screen.getByTestId("diff-filter-clear"));
    expect(screen.queryByTestId("diff-message-filter")).not.toBeInTheDocument();
    expect(screen.getByTestId("session-diff-view")).toBeInTheDocument();
  });
});
