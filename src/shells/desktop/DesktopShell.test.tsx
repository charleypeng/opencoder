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
  setActiveSession,
} from "../../stores/session";
import { messages, resetServer as resetMessages, upsertMessage } from "../../stores/messages";
import { applyTodos, resetServer as resetTodos } from "../../stores/todos";
import { openTab, resetServer as resetViewer, viewer } from "../../stores/viewer";
import { resetServer as resetDiffs } from "../../stores/diff";
import { resetServer as resetVcs } from "../../stores/vcs";
import { resetServer as resetModels } from "../../stores/models";
import { resetServer as resetPtys } from "../../stores/ptys";
import type { components } from "../../services/api/schema.js";
import type { Project } from "../../services/project";
import type { Session } from "../../services/session";
import { readRecentFiles } from "../../features/files/recentFiles";
import { clearToasts, createToast } from "../../stores/toasts";
import { combo } from "../../features/settings/shortcuts";
import { resetAllShortcuts, saveShortcutCombo } from "../../features/settings/shortcutStore";
import { enqueue, resetServer as resetPermissions } from "../../stores/permission";
import { resetServer as resetLsp } from "../../stores/lsp";
import type { PermissionRequest } from "../../services/permission";
import { resetServerUpdate } from "../../stores/serverUpdate";

type ListenHandler = (event: { payload: unknown }) => void;
type Listen = (event: string, handler: ListenHandler) => Promise<() => void>;

const {
  invokeMock,
  listenMock,
  sseSubscribeMock,
  qrToDataURLMock,
  openUrlMock,
  startNotificationsMock,
  startPetWatcherMock,
  subscribeToNotificationClickMock,
  focusWindowMock,
  showPetMock,
} = vi.hoisted(() => {
  const listenMock = vi.fn<Listen>(() => Promise.resolve(() => {}));
  return {
    invokeMock: vi.fn(),
    listenMock,
    sseSubscribeMock: vi.fn(),
    qrToDataURLMock: vi.fn(),
    openUrlMock: vi.fn(),
    startNotificationsMock: vi.fn(() => vi.fn()),
    startPetWatcherMock: vi.fn(() => vi.fn()),
    subscribeToNotificationClickMock: vi.fn<(cb: () => void) => () => void>(() => vi.fn()),
    focusWindowMock: vi.fn(async () => {}),
    showPetMock: vi.fn(async () => {}),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("../../services/sse.js", () => ({ sseSubscribe: sseSubscribeMock }));
vi.mock("qrcode", () => ({ default: { toDataURL: qrToDataURLMock } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("../../services/notificationEvents.js", () => ({
  startNotifications: startNotificationsMock,
}));
vi.mock("../../features/pet/petEvents.js", () => ({
  startPetWatcher: startPetWatcherMock,
}));
vi.mock("../../services/notifications.js", () => ({
  subscribeToNotificationClick: subscribeToNotificationClickMock,
  focusWindow: focusWindowMock,
}));
// The application updater facade (TASK-M8-09): the shell's once-a-day
// startup auto-check is inert in tests — the real facade would hit the
// updater IPC through the generic invoke mock and emit a bogus toast.
vi.mock("../../services/updates.js", () => ({
  checkForUpdates: vi.fn(async () => null),
  getAppVersion: vi.fn(async () => null),
  installAndRelaunch: vi.fn(async () => {}),
  loadLastCheck: vi.fn(() => undefined),
  recordLastCheck: vi.fn(),
  shouldAutoCheck: vi.fn(() => false),
}));
vi.mock("../../services/pet.js", () => ({
  showPet: showPetMock,
  hidePet: vi.fn(async () => {}),
  isPetVisible: vi.fn(async () => false),
  setPetState: vi.fn(async () => {}),
  setPetIgnoreMouse: vi.fn(async () => {}),
  setPetSize: vi.fn(async () => {}),
  setPetOpacity: vi.fn(async () => {}),
  setPetTopmost: vi.fn(async () => {}),
  setPetMute: vi.fn(async () => {}),
  setPetDock: vi.fn(async () => {}),
  subscribeToPetState: vi.fn(() => vi.fn()),
}));
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

/** Seeds a server's recent-projects memory so the first-entry onboarding
 *  dialog is skipped (hasWorkspaceHistory = true). Without this, a server
 *  with no default/explicit workspace triggers onboarding, and once prompted
 *  the tree shows ONLY the explicit+default list (Bug 3) — empty here — so
 *  tests that rely on the derived fallback would see a blank tree. */
function seedServerWorkspace(serverId: string): void {
  localStorage.setItem("oc-recent-projects:" + serverId, JSON.stringify([DEMO_DIR]));
}

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

// Mutable LSP status shared by the status-bar tests: the `lsp.updated`
// event makes the chip refetch GET /lsp, so the mock must reflect the
// change for the count to move.
let lspStatus: Array<Record<string, unknown>> = [];

// Routes the Tauri invoke calls the services make: server registry + the
// dual-project REST fixture. `/project/current` and `/session` are
// directory-aware so switching projects returns isolated data.
function mockHttpRoutes(servers: ServerEntry[]) {
  lspStatus = [
    { id: "lsp_ts_01", name: "typescript-language-server", root: DEMO_DIR, status: "connected" },
    { id: "lsp_go_01", name: "gopls", root: DEMO_DIR, status: "connected" },
    { id: "lsp_py_01", name: "pyright", root: DEMO_DIR, status: "error" },
  ];
  invokeMock.mockImplementation((cmd: string, payload: unknown) => {
    if (cmd === "list_servers") return Promise.resolve(servers);
    if (cmd === "http_request") {
      const request = (
        payload as {
          request?: {
            method?: string;
            path?: string;
            query?: Record<string, string | boolean>;
            body?: unknown;
          };
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
        // The workspace tree's cross-directory roots listing (no directory
        // context): every directory's top-level sessions. The invoke payload
        // carries the raw boolean query value.
        if (request?.query?.roots === true) {
          return Promise.resolve(
            httpResponse([
              session("sess_demo_01", DEMO_DIR),
              session("sess_labs_01", LABS_DIR, "project-mock-2"),
            ]),
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
      if (request?.method === "POST" && /^\/session\/.+\/fork$/.test(request?.path ?? "")) {
        // Fork (TASK-M6-03): a child session carrying the forked parent id.
        return Promise.resolve(
          httpResponse({
            id: "sess_forked_01",
            slug: "forked",
            projectID: "project-mock-1",
            directory: DEMO_DIR,
            parentID: (request?.path ?? "").split("/")[2],
            title: "",
            version: "1.18.11",
            time: { created: 1, updated: 1 },
          }),
        );
      }
      if (request?.method === "POST" && /^\/session\/.+\/revert$/.test(request?.path ?? "")) {
        // Revert (TASK-M6-04): the updated session carries the revert point.
        const sessionID = (request?.path ?? "").split("/")[2];
        return Promise.resolve(
          httpResponse({
            ...session(sessionID, DEMO_DIR),
            time: { created: 1, updated: 2 },
            revert: { messageID: (request?.body as { messageID?: string })?.messageID },
          }),
        );
      }
      if (request?.method === "POST" && /^\/session\/.+\/unrevert$/.test(request?.path ?? "")) {
        // Unrevert (TASK-M6-04): the updated session without a revert marker.
        const sessionID = (request?.path ?? "").split("/")[2];
        return Promise.resolve(
          httpResponse({ ...session(sessionID, DEMO_DIR), time: { created: 1, updated: 3 } }),
        );
      }
      if (request?.method === "POST" && /^\/session\/.+\/share$/.test(request?.path ?? "")) {
        // Share (TASK-M6-05): the updated session carries the share URL.
        const sessionID = (request?.path ?? "").split("/")[2];
        return Promise.resolve(
          httpResponse({
            ...session(sessionID, DEMO_DIR),
            time: { created: 1, updated: 4 },
            share: { url: `https://share.opencode.dev/s/${sessionID}` },
          }),
        );
      }
      if (request?.method === "DELETE" && /^\/session\/.+\/share$/.test(request?.path ?? "")) {
        // Unshare (TASK-M6-05): the updated session without the share marker.
        const sessionID = (request?.path ?? "").split("/")[2];
        return Promise.resolve(
          httpResponse({ ...session(sessionID, DEMO_DIR), time: { created: 1, updated: 5 } }),
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
      if (request?.path === "/vcs") {
        return Promise.resolve(httpResponse({ branch: "main", default_branch: "main" }));
      }
      if (request?.path === "/lsp") {
        return Promise.resolve(httpResponse([...lspStatus]));
      }
      if (request?.path === "/formatter") {
        return Promise.resolve(
          httpResponse([
            { name: "biome", extensions: ["ts"], enabled: true },
            { name: "prettier", extensions: ["md"], enabled: false },
          ]),
        );
      }
      if (request?.path === "/vcs/status") {
        return Promise.resolve(
          httpResponse([
            { file: "src/features/a.ts", additions: 12, deletions: 4, status: "modified" },
          ]),
        );
      }
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
      if (request?.path === "/provider/auth") {
        return Promise.resolve(
          httpResponse({
            openai: [{ type: "api", label: "API key" }],
            azure: [{ type: "oauth", label: "OAuth" }],
          }),
        );
      }
      if (request?.path === "/provider") {
        return Promise.resolve(
          httpResponse({
            all: [
              {
                id: "openai",
                name: "OpenAI",
                source: "env",
                env: ["OPENAI_API_KEY"],
                options: {},
                models: {},
              },
              {
                id: "azure",
                name: "Azure OpenAI",
                source: "custom",
                env: [],
                options: {},
                models: {},
              },
            ],
            default: {},
            connected: ["openai"],
          }),
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
      if (request?.path === "/session/sess_revert_01/message") {
        // Revert history (TASK-M6-04): three messages, the middle one
        // carrying a snapshot part (the M6-04 snapshot-chip entry point).
        return Promise.resolve(
          httpResponse([
            {
              info: {
                id: "msg_r1",
                sessionID: "sess_revert_01",
                role: "user",
                time: { created: 1, updated: 1 },
              },
              parts: [
                {
                  id: "prt_r1",
                  sessionID: "sess_revert_01",
                  messageID: "msg_r1",
                  type: "text",
                  text: "first",
                },
              ],
            },
            {
              info: {
                id: "msg_r2",
                sessionID: "sess_revert_01",
                role: "assistant",
                time: { created: 2, updated: 2 },
              },
              parts: [
                {
                  id: "prt_r2",
                  sessionID: "sess_revert_01",
                  messageID: "msg_r2",
                  type: "text",
                  text: "second",
                },
                {
                  id: "prt_snap",
                  sessionID: "sess_revert_01",
                  messageID: "msg_r2",
                  type: "snapshot",
                  snapshot: "snp_a1b2c3d4e5f6",
                },
              ],
            },
            {
              info: {
                id: "msg_r3",
                sessionID: "sess_revert_01",
                role: "assistant",
                time: { created: 3, updated: 3 },
              },
              parts: [
                {
                  id: "prt_r3",
                  sessionID: "sess_revert_01",
                  messageID: "msg_r3",
                  type: "text",
                  text: "third",
                },
              ],
            },
          ]),
        );
      }
      if (request?.path === "/session/sess_sub_parent/message") {
        // Subtree history (TASK-M6-07): one assistant message carrying a
        // subtask part whose "Open child session" button jumps to the
        // session's first child.
        return Promise.resolve(
          httpResponse([
            {
              info: {
                id: "msg_sub",
                sessionID: "sess_sub_parent",
                role: "assistant",
                time: { created: 1, updated: 1 },
              },
              parts: [
                {
                  id: "prt_sub",
                  sessionID: "sess_sub_parent",
                  messageID: "msg_sub",
                  type: "subtask",
                  prompt: "Investigate the login flow",
                  description: "Trace the login flow end to end",
                  agent: "build",
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
  qrToDataURLMock.mockClear().mockResolvedValue("data:image/png;base64,QRDATA");
  openUrlMock.mockClear().mockResolvedValue(undefined);
  startNotificationsMock.mockClear();
  startPetWatcherMock.mockClear();
  subscribeToNotificationClickMock.mockClear();
  focusWindowMock.mockClear();
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
  resetVcs("srv-m4vcs");
  resetVcs("srv-m4vcsbar");
  resetLsp("srv-m4lspbar");
  resetLsp("srv-m4usagebar");
  resetModels("srv-m5settings");
  resetPtys("srv-m6term");
  resetSessions("srv-m6tree");
  resetSessions("srv-m6tree2");
  resetSessions("srv-m8new");
  resetSessions("srv-m8step");
  resetSessions("srv-m8scope");
  resetMessages("srv-m8scope");
  resetTodos("srv-m8scope");
  resetAllShortcuts();
  localStorage.removeItem("oc-recent-files:srv-m4quick");
  resetServerUpdate("srv-m8upd1");
  resetServerUpdate("srv-m8upd2");
  resetServerUpdate("srv-m8upd3");
  resetServerUpdate("srv-m8upd4");
});
describe("DesktopShell workspace", () => {
  it("mounts the shell, activates the server context and shows placeholders", () => {
    const alpha = server({ id: "srv-alpha", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    expect(getActiveServerId()).toBe("srv-alpha");
    expect(screen.getByTestId("desktop-shell")).toBeInTheDocument();
    // The sidebar's workspace tree renders the (empty) snapshot immediately.
    expect(screen.getByTestId("workspace-tree")).toBeInTheDocument();
    expect(screen.getByText("No workspaces yet")).toBeInTheDocument();
    expect(screen.getByText("Select a session")).toBeInTheDocument();
  });

  it("renders toasts from the toast store (TASK-M6-06)", () => {
    const alpha = server({ id: "srv-alpha", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    createToast("Context compressed", "success");
    const toast = screen.getByTestId("toast");
    expect(toast).toHaveAttribute("data-kind", "success");
    expect(toast).toHaveTextContent("Context compressed");
    clearToasts();
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

describe("DesktopShell default-workspace onboarding (feat(default-workspace))", () => {
  it("prompts for a default workspace on the first entry of a fresh server", async () => {
    const alpha = server({ id: "srv-onboard1", name: "Alpha" });
    localStorage.removeItem("oc-default-workspace:srv-onboard1");
    localStorage.removeItem("oc-recent-projects:srv-onboard1");
    localStorage.removeItem("oc-default-workspace-prompted:srv-onboard1");
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    // The onboarding picker opens over the (still mounted) shell.
    await waitFor(() => expect(screen.getByTestId("directory-picker-dialog")).toBeInTheDocument());
    expect(screen.getByText("Choose a default workspace")).toBeInTheDocument();
  });

  it("does not prompt when the server already has a default workspace", () => {
    const alpha = server({ id: "srv-onboard2", name: "Alpha" });
    localStorage.setItem("oc-default-workspace:srv-onboard2", JSON.stringify("/dev/opencode"));
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    expect(screen.queryByTestId("directory-picker-dialog")).toBeNull();
  });

  it("does not re-prompt after a skipped onboarding", async () => {
    const alpha = server({ id: "srv-onboard3", name: "Alpha" });
    localStorage.removeItem("oc-default-workspace:srv-onboard3");
    localStorage.removeItem("oc-recent-projects:srv-onboard3");
    localStorage.removeItem("oc-default-workspace-prompted:srv-onboard3");
    invokeMock.mockResolvedValueOnce([alpha]);
    const { unmount } = render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("directory-picker-dialog")).toBeInTheDocument());
    unmount();

    // Re-entering the same server: the prompt was marked shown, no dialog.
    const client = invokeMock.mockResolvedValueOnce([alpha]);
    void client;
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    expect(screen.queryByTestId("directory-picker-dialog")).toBeNull();
  });
});

describe("DesktopShell workspace tree and SSE wiring (TASK-M2-03)", () => {
  it("mounts the workspace tree and opens the server's per-directory stream", async () => {
    const alpha = server({ id: "srv-sse", name: "Alpha" });
    mockHttpRoutes([alpha]);
    seedServerWorkspace(alpha.id);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("workspace-tree")).toBeInTheDocument());
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    expect(lastSseCall()[0]).toBe("srv-sse");
    expect(lastSseCall()[1]).toBe(DEMO_DIR);

    // The tree's load seeded the store with both fixture projects.
    await waitFor(() =>
      expect(getServerProjectState("srv-sse").projects.map((p) => p.id)).toEqual([
        "project-mock-1",
        "project-mock-2",
      ]),
    );
    // Both directories render as folders; the demo folder holds its session.
    await waitFor(() =>
      expect(
        screen.getByTestId("workspace-folder-/mock/projects/opencode-demo"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("workspace-folder-/mock/projects/opencode-labs")).toBeInTheDocument();
    // The session list arrives asynchronously (roots fetch), so wait for it.
    await waitFor(() =>
      expect(screen.getByTestId("workspace-session-sess_demo_01")).toBeInTheDocument(),
    );
  });

  it("switching to a session in another directory rebuilds the stream, unsubscribes the old one and re-syncs isolated sessions", async () => {
    const alpha = server({ id: "srv-switch", name: "Alpha" });
    mockHttpRoutes([alpha]);
    seedServerWorkspace(alpha.id);
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

    // Selecting the labs session (a different directory) switches context.
    fireEvent.click(await screen.findByTestId("workspace-session-sess_labs_01"));

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
    seedServerWorkspace(alpha.id);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    // The shell resets session state while (re)building the stream, so seed
    // the store afterwards — like a live SSE session.updated event.
    applySessionList("srv-sel", [session("sess_sel_01", DEMO_DIR)]);

    fireEvent.click(await screen.findByTestId("workspace-session-sess_sel_01"));
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

    // The header "+" creates the session directly in the current working
    // directory, which opens the message list.
    fireEvent.click(screen.getByTestId("workspace-new-session"));

    await waitFor(() =>
      expect(getServerSessionState("srv-new").activeSessionId).toBe("sess_new_01"),
    );
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(sessions["srv-new"]?.order).toContain("sess_new_01");
  });

  it("mounts the prompt box below the message list for the active session (TASK-M2-08)", async () => {
    const alpha = server({ id: "srv-prompt", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    seedServerWorkspace(alpha.id);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-prompt", [session("sess_prompt_01", DEMO_DIR)]);

    fireEvent.click(await screen.findByTestId("workspace-session-sess_prompt_01"));

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
    expect(screen.getByText("Select a session")).toBeInTheDocument();
  });

  it("switches the sidebar between Sessions and Files (TASK-M4-02)", async () => {
    const alpha = server({ id: "srv-files", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    expect(screen.getByTestId("sidebar-view-sessions")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("sidebar-view-sessions")).toHaveTextContent("Workspaces");
    expect(screen.queryByText("Sessions", { selector: "button" })).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-tree")).toBeInTheDocument();
    expect(screen.queryByTestId("file-tree")).not.toBeInTheDocument();

    // The Files view mounts the tree (empty workspace renders the empty state).
    fireEvent.click(screen.getByTestId("sidebar-view-files"));
    expect(screen.getByTestId("sidebar-view-files")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-tree")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("file-tree-empty")).toBeInTheDocument());

    // Back to sessions.
    fireEvent.click(screen.getByTestId("sidebar-view-sessions"));
    expect(screen.getByTestId("workspace-tree")).toBeInTheDocument();
    expect(screen.queryByTestId("file-tree")).not.toBeInTheDocument();
  });
});

describe("DesktopShell task panel (composer dock)", () => {
  it("auto-expands when todos arrive and auto-collapses when everything completes", async () => {
    const alpha = server({ id: "srv-tasks", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-tasks", [session("sess_task_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_task_01"));

    // No todos yet → no panel above the composer.
    expect(screen.queryByTestId("task-panel")).not.toBeInTheDocument();

    // A todo arrives (todo.updated) → the panel appears, expanded, with
    // the n/m progress.
    applyTodos("srv-tasks", "sess_task_01", [
      { content: "Explore the repo", status: "in_progress", priority: "high" },
      { content: "Summarize the code", status: "pending", priority: "medium" },
    ]);
    const panel = await screen.findByTestId("task-panel");
    expect(panel).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("task-panel-progress")).toHaveTextContent("0/2");
    const items = screen.getAllByTestId("todo-item");
    expect(items).toHaveLength(2);

    // A store mutation (live event) updates the open panel immediately.
    applyTodos("srv-tasks", "sess_task_01", [
      { content: "Explore the repo", status: "completed", priority: "high" },
      { content: "Summarize the code", status: "in_progress", priority: "medium" },
    ]);
    await waitFor(() => expect(screen.getByText("Explore the repo")).toHaveClass("line-through"));
    expect(screen.getByTestId("task-panel-progress")).toHaveTextContent("1/2");

    // Everything completes → the panel auto-collapses (still visible).
    applyTodos("srv-tasks", "sess_task_01", [
      { content: "Explore the repo", status: "completed", priority: "high" },
      { content: "Summarize the code", status: "completed", priority: "medium" },
    ]);
    await waitFor(() =>
      expect(screen.getByTestId("task-panel")).toHaveAttribute("data-collapsed", "true"),
    );

    // A completed panel remains user-expandable.
    fireEvent.click(screen.getByTestId("task-panel-toggle"));
    expect(screen.getByTestId("task-panel")).toHaveAttribute("data-collapsed", "false");
  });

  it("manual collapse and the header Tasks button force-expands", async () => {
    const alpha = server({ id: "srv-tasks-manual", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-tasks-manual", [session("sess_task_02", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_task_02"));

    applyTodos("srv-tasks-manual", "sess_task_02", [
      { content: "Do the thing", status: "in_progress", priority: "medium" },
    ]);
    const panel = await screen.findByTestId("task-panel");
    expect(panel).toHaveAttribute("data-collapsed", "false");

    // Manual collapse via the header chevron.
    fireEvent.click(screen.getByTestId("task-panel-toggle"));
    expect(panel).toHaveAttribute("data-collapsed", "true");

    // The chat header's Tasks button force-expands it again.
    fireEvent.click(screen.getByTestId("todo-toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("task-panel")).toHaveAttribute("data-collapsed", "false"),
    );
  });
});

describe("DesktopShell main view tabs (TASK-M4-03)", () => {
  it("renders the Chat|Files tab bar with Chat selected and switches to the empty viewer", async () => {
    const alpha = server({ id: "srv-m4view", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    expect(screen.getByTestId("main-tab-chat")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("main-tab-files")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Select a session")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("main-tab-files"));
    expect(screen.getByTestId("main-tab-files")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("file-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("viewer-empty")).toBeInTheDocument();
    expect(screen.queryByText("Select a session")).not.toBeInTheDocument();

    // Back to Chat restores the chat pane.
    fireEvent.click(screen.getByTestId("main-tab-chat"));
    expect(screen.getByTestId("main-tab-chat")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Select a session")).toBeInTheDocument();
  });

  it("switching to a session in another directory clears the viewer tabs and active path (TASK-M4-03)", async () => {
    const alpha = server({ id: "srv-m4view", name: "Alpha" });
    mockHttpRoutes([alpha]);
    seedServerWorkspace(alpha.id);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // Seed viewer state the way an open file would (store-level; the shell
    // drops it when the context rebuilds).
    openTab("srv-m4view", "README.md");
    expect(viewer["srv-m4view"]?.tabs.map((tab) => tab.path)).toEqual(["README.md"]);
    expect(viewer["srv-m4view"]?.activePath).toBe("README.md");

    // Selecting the labs session (a different directory) rebuilds the context.
    fireEvent.click(await screen.findByTestId("workspace-session-sess_labs_01"));

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
    expect(screen.getByTestId("main-tab-files")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("viewer-tab-README.md")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("viewer-markdown")).toBeInTheDocument());
    expect(viewer["srv-m4view"]?.tabs.map((tab) => tab.path)).toEqual(["README.md"]);

    // A second click re-activates the existing tab without a duplicate.
    fireEvent.click(screen.getByTestId("file-row-README.md"));
    expect(viewer["srv-m4view"]?.tabs).toHaveLength(1);
  });

  it("the workspace ⋯ menu's view folder jumps to the Files view in that directory", async () => {
    const alpha = server({ id: "srv-viewfolder", name: "Alpha" });
    // Seed the workspace list so both folders render without onboarding
    // (Bug 3: a prompted server shows ONLY the explicit + default list,
    // so the labs folder must be added explicitly to appear).
    localStorage.setItem("oc-default-workspace:srv-viewfolder", JSON.stringify(DEMO_DIR));
    localStorage.setItem("oc-workspaces:srv-viewfolder", JSON.stringify([DEMO_DIR, LABS_DIR]));
    localStorage.setItem("oc-default-workspace-prompted:srv-viewfolder", "1");
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("workspace-folder-/mock/projects/opencode-labs"),
      ).toBeInTheDocument(),
    );

    fireEvent.click(
      within(screen.getByTestId("workspace-folder-/mock/projects/opencode-labs")).getByTestId(
        "workspace-folder-more",
      ),
    );
    fireEvent.click(await screen.findByTestId("workspace-folder-menu-view-folder"));

    // Viewing a folder switches the session context to the picked workspace
    // (every file request is routed by the active directory, so browsing a
    // folder must set it — otherwise subtree/content/status requests answer
    // for the wrong workspace), points the sidebar file tree at it and
    // shows the Files view.
    await waitFor(() =>
      expect(getServerProjectState("srv-viewfolder").current).toBe("/mock/projects/opencode-labs"),
    );
    expect(screen.getByTestId("main-tab-files")).toHaveAttribute("aria-current", "true");
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-view-files")).toHaveAttribute("aria-selected", "true"),
    );
    // The sidebar file tree browses the picked directory (GET /file?directory=).
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.some(
          (call) =>
            (call[0] as string) === "http_request" &&
            (call[1] as { request?: { path?: string; query?: Record<string, string> } }).request
              ?.path === "/file" &&
            (call[1] as { request?: { query?: Record<string, string> } }).request?.query
              ?.directory === "/mock/projects/opencode-labs",
        ),
      ).toBe(true),
    );
  });
});

describe("DesktopShell workspace session creation (bug fixes)", () => {
  it("header new-session opens the new chat in the chat pane", async () => {
    const alpha = server({ id: "srv-bug2", name: "Alpha" });
    // Default workspace + explicit list both point at the demo directory.
    localStorage.setItem("oc-default-workspace:srv-bug2", JSON.stringify(DEMO_DIR));
    localStorage.setItem("oc-workspaces:srv-bug2", JSON.stringify([DEMO_DIR]));
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("workspace-new-session")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("workspace-new-session"));

    // The created session becomes active and the chat pane shows it.
    await waitFor(() =>
      expect(getServerSessionState("srv-bug2").activeSessionId).toBe("sess_new_01"),
    );
    expect(screen.getByTestId("chat-session-title")).toBeInTheDocument();
  });

  it("header new-session returns to the chat pane even from the Files view", async () => {
    const alpha = server({ id: "srv-bug2b", name: "Alpha" });
    localStorage.setItem("oc-default-workspace:srv-bug2b", JSON.stringify(DEMO_DIR));
    localStorage.setItem("oc-workspaces:srv-bug2b", JSON.stringify([DEMO_DIR]));
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("workspace-new-session")).toBeInTheDocument());

    // Switch to the Files view first, then create a session.
    fireEvent.click(screen.getByTestId("main-tab-files"));
    fireEvent.click(screen.getByTestId("workspace-new-session"));

    await waitFor(() =>
      expect(getServerSessionState("srv-bug2b").activeSessionId).toBe("sess_new_01"),
    );
    expect(screen.getByTestId("main-tab-chat")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("chat-session-title")).toBeInTheDocument();
  });

  it("a workspace [+] button opens the new session chat", async () => {
    const alpha = server({ id: "srv-bug2c", name: "Alpha" });
    localStorage.setItem("oc-workspaces:srv-bug2c", JSON.stringify([DEMO_DIR]));
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("workspace-folder-/mock/projects/opencode-demo"),
      ).toBeInTheDocument(),
    );

    fireEvent.click(
      within(screen.getByTestId("workspace-folder-/mock/projects/opencode-demo")).getByTestId(
        "workspace-folder-add",
      ),
    );

    await waitFor(() =>
      expect(getServerSessionState("srv-bug2c").activeSessionId).toBe("sess_new_01"),
    );
    expect(screen.getByTestId("chat-session-title")).toBeInTheDocument();
  });

  it("a server.connected reconnect after the rebuild keeps the new chat open (Bug: reconnect cleared it)", async () => {
    // The real server reconnects idle SSE streams; every reconnect emits
    // server.connected, which resets the session bucket (activeSessionId ->
    // null). The previous one-shot restore only ran after the rebuild's own
    // re-sync, so a reconnect arriving later left the chat on the "Select a
    // session" placeholder. The restore candidate must survive ANY reset.
    const alpha = server({ id: "srv-bugreconn", name: "Alpha" });
    localStorage.setItem("oc-default-workspace:srv-bugreconn", JSON.stringify(DEMO_DIR));
    localStorage.setItem("oc-workspaces:srv-bugreconn", JSON.stringify([DEMO_DIR]));
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("workspace-new-session")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("workspace-new-session"));
    await waitFor(() =>
      expect(getServerSessionState("srv-bugreconn").activeSessionId).toBe("sess_new_01"),
    );
    expect(screen.getByTestId("chat-session-title")).toBeInTheDocument();

    // Deliver server.connected through the ACTIVE SSE subscription — like a
    // stream reconnect minutes after the rebuild settled.
    const handler = lastSseCall()[2] as (event: { type: string; properties?: object }) => void;
    handler({ type: "server.connected", properties: {} });

    // The reset wipes the bucket, but the chat pane returns to the session.
    await waitFor(() =>
      expect(getServerSessionState("srv-bugreconn").activeSessionId).toBe("sess_new_01"),
    );
    expect(screen.getByTestId("chat-session-title")).toBeInTheDocument();
    expect(screen.queryByText("Select a session")).not.toBeInTheDocument();
  });

  it("clicking a session in an added workspace opens its chat", async () => {
    const alpha = server({ id: "srv-bug4", name: "Alpha" });
    // The labs workspace is added explicitly; its session comes from roots.
    localStorage.setItem("oc-workspaces:srv-bug4", JSON.stringify([DEMO_DIR, LABS_DIR]));
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByTestId("workspace-session-sess_labs_01")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("workspace-session-sess_labs_01"));

    await waitFor(() =>
      expect(getServerSessionState("srv-bug4").activeSessionId).toBe("sess_labs_01"),
    );
    // The chat pane renders the selected session's header.
    await waitFor(() =>
      expect(screen.getByTestId("chat-session-title")).toHaveTextContent(/sess_labs_01|Labs/i),
    );
  });
});

describe("DesktopShell settings view (TASK-M5-06)", () => {
  it("the gear button opens the settings dialog and its close returns to chat", async () => {
    const alpha = server({ id: "srv-m5settings", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("rail-settings"));
    expect(screen.getByTestId("settings-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
    // The settings dialog floats above the chat view; the chat tab bar
    // stays in place underneath.
    expect(screen.getByTestId("main-tab-chat")).toBeInTheDocument();

    // The settings center opens on the General section by default.
    expect(screen.getByTestId("general-section")).toBeInTheDocument();

    // The providers section is reachable from the nav and renders the rows.
    fireEvent.click(screen.getByTestId("settings-section-providers"));
    await waitFor(() => expect(screen.getByTestId("provider-key-row-openai")).toBeInTheDocument());
    expect(screen.getByTestId("provider-key-row-openai")).toHaveAttribute("data-connected", "true");
    // Unconnected providers (azure, the OAuth one) collapse behind the
    // Show-more toggle; expanding it reveals the Authorize button.
    expect(screen.queryByTestId("provider-oauth-authorize")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("provider-keys-toggle"));
    expect(screen.getByTestId("provider-oauth-authorize")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-close"));
    expect(screen.getByTestId("main-tab-chat")).toHaveAttribute("aria-current", "true");
    expect(screen.queryByTestId("settings-dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-page")).not.toBeInTheDocument();
  });

  it("the settings dialog backdrop click closes it", async () => {
    const alpha = server({ id: "srv-m5backdrop", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("rail-settings"));
    expect(screen.getByTestId("settings-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-dialog-backdrop"));
    expect(screen.queryByTestId("settings-dialog")).not.toBeInTheDocument();
  });
});

describe("DesktopShell prominent settings entry (TASK-S1-03)", () => {
  it("the rail gear is visible in the chat view and opens settings", async () => {
    const alpha = server({ id: "srv-s1rail", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    const railSettings = screen.getByTestId("rail-settings");
    expect(railSettings).toBeInTheDocument();
    fireEvent.click(railSettings);
    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
  });

  it("the rail gear persists into the terminal and diff views and opens settings from there", async () => {
    const alpha = server({ id: "srv-s1rail", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-s1rail", [session("sess_s1_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_s1_01"));

    // Terminal view: the main-area tab bar is gone but the rail gear stays.
    fireEvent.click(screen.getByTestId("terminal-toggle"));
    await waitFor(() => expect(screen.getByTestId("terminal-panel")).toBeInTheDocument());
    expect(screen.queryByTestId("main-tab-chat")).not.toBeInTheDocument();
    expect(screen.getByTestId("rail-settings")).toBeInTheDocument();

    // Diff view: same persistence for the other main-view switch target.
    fireEvent.click(screen.getByTestId("terminal-back"));
    await waitFor(() => expect(screen.getByTestId("main-tab-chat")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    expect(screen.getByTestId("session-diff-view")).toBeInTheDocument();
    expect(screen.getByTestId("rail-settings")).toBeInTheDocument();

    // The rail gear works from the diff view too — settings floats above
    // the diff instead of replacing it.
    fireEvent.click(screen.getByTestId("rail-settings"));
    expect(screen.getByTestId("settings-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
    expect(screen.getByTestId("session-diff-view")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-close"));
    expect(screen.queryByTestId("settings-dialog")).not.toBeInTheDocument();
  });

  it("⌘, opens settings from a non-chat view as well", async () => {
    const alpha = server({ id: "srv-s1rail", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("terminal-toggle"));
    await waitFor(() => expect(screen.getByTestId("terminal-panel")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: ",", metaKey: true });
    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
  });
});

describe("DesktopShell terminal view (TASK-M6-02)", () => {
  it("⌘J opens the terminal view and toggles back to chat", async () => {
    const alpha = server({ id: "srv-m6term", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: "j", metaKey: true });
    // TASK-M9-08: the terminal panel is lazy-loaded (xterm split out of the
    // startup chunk), so the view appears after the dynamic import resolves.
    await waitFor(() => expect(screen.getByTestId("terminal-panel")).toBeInTheDocument());
    // The tab bar is hidden while the terminal view is open.
    expect(screen.queryByTestId("main-tab-chat")).not.toBeInTheDocument();

    // A second ⌘J toggles back to the chat view.
    fireEvent.keyDown(window, { key: "J", ctrlKey: true });
    expect(screen.queryByTestId("terminal-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("main-tab-chat")).toBeInTheDocument();
  });

  it("fires ⌘J even while typing in a text control", async () => {
    const alpha = server({ id: "srv-m6term", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m6term", [session("sess_term_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_term_01"));

    // A ⌘/Ctrl combo types nothing into the control, so the input guard
    // does not apply (docs/ui-audit-2026-08 V3).
    fireEvent.keyDown(screen.getByTestId("prompt-input"), { key: "j", metaKey: true });
    // TASK-M9-08: lazy-loaded terminal panel (xterm chunk) — await it.
    await waitFor(() => expect(screen.getByTestId("terminal-panel")).toBeInTheDocument());
  });

  it("the terminal toggle button opens the view and Back returns to chat", async () => {
    const alpha = server({ id: "srv-m6term", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("terminal-toggle"));
    // TASK-M9-08: lazy-loaded terminal panel (xterm chunk) — await it.
    await waitFor(() => expect(screen.getByTestId("terminal-panel")).toBeInTheDocument());
    expect(screen.queryByTestId("main-tab-chat")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("terminal-back"));
    expect(screen.queryByTestId("terminal-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("main-tab-chat")).toHaveAttribute("aria-current", "true");
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
    expect(screen.getByTestId("main-tab-files")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("viewer-tab-README.md")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("viewer-markdown")).toBeInTheDocument());
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

  it("fires ⌘P even while typing in a text control", async () => {
    const alpha = server({ id: "srv-m4quick", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m4quick", [session("sess_qp_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_qp_01"));

    // A ⌘/Ctrl combo types nothing into the control, so the input guard
    // does not apply (docs/ui-audit-2026-08 V3): ⌘P opens the dialog
    // while the composer input is focused.
    fireEvent.keyDown(screen.getByTestId("prompt-input"), { key: "p", metaKey: true });
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
    expect(screen.getByTestId("main-tab-files")).toHaveAttribute("aria-current", "true");
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

  it("fires ⌘⇧F even while typing in a text control", async () => {
    const alpha = server({ id: "srv-m4search", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m4search", [session("sess_sf_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_sf_01"));

    // A ⌘/Ctrl combo types nothing into the control, so the input guard
    // does not apply (docs/ui-audit-2026-08 V3).
    fireEvent.keyDown(screen.getByTestId("prompt-input"), {
      key: "F",
      shiftKey: true,
      metaKey: true,
    });
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
    fireEvent.click(await screen.findByTestId("workspace-session-sess_diff_01"));

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

  it("⌘D opens from the prompt input and toggles back to chat", async () => {
    const alpha = server({ id: "srv-m4diff", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m4diff", [session("sess_diff_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_diff_01"));

    // A ⌘/Ctrl combo types nothing into the control, so the input guard
    // does not apply (docs/ui-audit-2026-08 V3): ⌘D opens while typing.
    fireEvent.keyDown(screen.getByTestId("prompt-input"), { key: "d", metaKey: true });
    expect(screen.getByTestId("session-diff-view")).toBeInTheDocument();

    // A second ⌘D toggles back to chat.
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
    fireEvent.click(await screen.findByTestId("workspace-session-sess_diff_01"));
    await waitFor(() => expect(screen.getByTestId("message-msg_02")).toBeInTheDocument());

    // Message menu → View diff jumps Main to the diff view filtered to the
    // message id (the request carries the messageID query).
    const invokeForDiff = invokeMock.mock.calls.filter(
      (call) =>
        call[0] === "http_request" && /^\/session\/.+\/diff$/.test(call[1].request?.path ?? ""),
    );
    expect(invokeForDiff).toHaveLength(0);

    fireEvent.click(screen.getByTestId("message-actions"));
    const item = await screen.findByTestId("message-action-view-diff");
    expect(item).not.toBeDisabled();
    fireEvent.click(item);

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

  it("message Fork from here forks the session and opens the child", async () => {
    const alpha = server({ id: "srv-m6fork", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    // sess_diff_01 has a message route in mockHttpRoutes (msg_02 renders).
    applySessionList("srv-m6fork", [session("sess_diff_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_diff_01"));
    await waitFor(() => expect(screen.getByTestId("message-msg_02")).toBeInTheDocument());

    // Message menu → Fork from here: POST /session/{id}/fork with the
    // messageID; the child enters the store, opens in chat and shows as a
    // forked row under its parent in the list.
    fireEvent.click(screen.getByTestId("message-actions"));
    const item = await screen.findByTestId("message-action-fork");
    expect(item).not.toBeDisabled();
    fireEvent.click(item);

    await waitFor(() =>
      expect(getServerSessionState("srv-m6fork").sessions["sess_forked_01"]).toBeDefined(),
    );
    const forkCalls = invokeMock.mock.calls.filter(
      (call) =>
        call[0] === "http_request" && /^\/session\/.+\/fork$/.test(call[1].request?.path ?? ""),
    );
    expect(forkCalls).toHaveLength(1);
    expect(forkCalls[0][1].request.body).toEqual({ messageID: "msg_02" });
    expect(getServerSessionState("srv-m6fork").activeSessionId).toBe("sess_forked_01");
    // The forked child opens in chat; it does NOT render as a sidebar row
    // (subagent children live in the per-session subtask panel).
    await waitFor(() =>
      expect(screen.getByTestId("chat-session-title")).toHaveTextContent("forked"),
    );
    expect(screen.queryByTestId("workspace-session-sess_forked_01")).toBeNull();
  });
});

describe("DesktopShell message revert (TASK-M6-04)", () => {
  const SESSION_REVERT = "sess_revert_01";

  async function openRevertChat(serverId: string) {
    applySessionList(serverId, [session(SESSION_REVERT, DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId(`workspace-session-${SESSION_REVERT}`));
    await waitFor(() => expect(screen.getByTestId("message-msg_r3")).toBeInTheDocument());
  }

  /** Opens the "⋯" menu of a specific message and clicks a menu item. */
  async function pickMessageAction(messageId: string, actionTestId: string) {
    const row = screen.getByTestId(`message-${messageId}`);
    fireEvent.click(within(row).getByTestId("message-actions"));
    const item = await screen.findByTestId(actionTestId);
    expect(item).not.toBeDisabled();
    fireEvent.click(item);
  }

  function revertCalls() {
    return invokeMock.mock.calls.filter(
      (call) =>
        call[0] === "http_request" && /^\/session\/.+\/revert$/.test(call[1].request?.path ?? ""),
    );
  }

  it("revert warns about file changes; cancel makes no call", async () => {
    const alpha = server({ id: "srv-m6rev", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openRevertChat("srv-m6rev");

    await pickMessageAction("msg_r2", "message-action-revert");

    const dialog = await screen.findByTestId("revert-message-dialog");
    expect(dialog).toHaveTextContent(/file changes/i);
    expect(dialog).toHaveTextContent("msg_r2");
    fireEvent.click(screen.getByTestId("revert-message-cancel"));
    await waitFor(() =>
      expect(screen.queryByTestId("revert-message-dialog")).not.toBeInTheDocument(),
    );
    expect(revertCalls()).toHaveLength(0);
    // Re-seed: the mount-time session re-sync (server.connected) replaced
    // the seeded list; assert on the current entry, not a stale one.
    applySessionList("srv-m6rev", [session(SESSION_REVERT, DEMO_DIR)]);
    expect(getServerSessionState("srv-m6rev").sessions[SESSION_REVERT].revert).toBeUndefined();
  });

  it("confirm reverts: POST with the messageID, store marker, reverted bar, grayed later messages", async () => {
    const alpha = server({ id: "srv-m6rev2", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openRevertChat("srv-m6rev2");

    await pickMessageAction("msg_r2", "message-action-revert");
    fireEvent.click(await screen.findByTestId("revert-message-confirm"));

    await waitFor(() =>
      expect(getServerSessionState("srv-m6rev2").sessions[SESSION_REVERT].revert?.messageID).toBe(
        "msg_r2",
      ),
    );
    const calls = revertCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1].request.body).toEqual({ messageID: "msg_r2" });

    // The reverted bar names the point; the row AFTER it is grayed, the
    // point row and the rows before it stay active.
    const bar = await screen.findByTestId("reverted-bar");
    expect(bar).toHaveTextContent("msg_r2");
    const revertedOf = (id: string) =>
      screen.getByTestId(`message-${id}`).closest("[data-reverted]") as HTMLElement;
    expect(revertedOf("msg_r1")).toHaveAttribute("data-reverted", "false");
    expect(revertedOf("msg_r2")).toHaveAttribute("data-reverted", "false");
    expect(revertedOf("msg_r3")).toHaveAttribute("data-reverted", "true");
  });

  it("unrevert restores the session in one click", async () => {
    const alpha = server({ id: "srv-m6rev3", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openRevertChat("srv-m6rev3");
    // Seed the revert marker (as if a revert just completed server-side).
    applySessionList("srv-m6rev3", [
      { ...session(SESSION_REVERT, DEMO_DIR), revert: { messageID: "msg_r2" } },
    ]);
    await waitFor(() => expect(screen.getByTestId("reverted-bar")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("unrevert"));

    await waitFor(() => expect(screen.queryByTestId("reverted-bar")).not.toBeInTheDocument());
    expect(getServerSessionState("srv-m6rev3").sessions[SESSION_REVERT].revert).toBeUndefined();
    const unrevertCalls = invokeMock.mock.calls.filter(
      (call) =>
        call[0] === "http_request" && /^\/session\/.+\/unrevert$/.test(call[1].request?.path ?? ""),
    );
    expect(unrevertCalls).toHaveLength(1);
  });

  it("snapshot chip opens the revert flow for its containing message", async () => {
    const alpha = server({ id: "srv-m6rev4", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openRevertChat("srv-m6rev4");

    // The snapshot chip inside msg_r2 is a revert trigger: the confirm flow
    // runs against the message that carries the snapshot.
    fireEvent.click(screen.getByTestId("snapshot-part"));
    const dialog = await screen.findByTestId("revert-message-dialog");
    expect(dialog).toHaveTextContent("msg_r2");
    fireEvent.click(screen.getByTestId("revert-message-confirm"));

    await waitFor(() =>
      expect(getServerSessionState("srv-m6rev4").sessions[SESSION_REVERT].revert?.messageID).toBe(
        "msg_r2",
      ),
    );
    const calls = revertCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1].request.body).toEqual({ messageID: "msg_r2" });
  });
});

describe("DesktopShell task navigation", () => {
  it("does not render subtask cards in the chat transcript", async () => {
    const alpha = server({ id: "srv-m6tree", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m6tree", [session("sess_sub_parent", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_sub_parent"));
    expect(screen.queryByTestId("subtask-part")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-part")).not.toBeInTheDocument();
  });
});

describe("DesktopShell VCS panel and status bar (TASK-M4-08)", () => {
  it("opens the Changes view from the Files tab and Back returns to Files", async () => {
    const alpha = server({ id: "srv-m4vcs", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // The changes toggle only exists on the Files tab.
    expect(screen.queryByTestId("changes-toggle")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("main-tab-files"));
    fireEvent.click(screen.getByTestId("changes-toggle"));

    // The Changes view replaces the tab bar with its own header + panel.
    expect(screen.getByTestId("vcs-panel")).toBeInTheDocument();
    expect(screen.getByText("Changes")).toBeInTheDocument();
    expect(screen.queryByTestId("main-tab-chat")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("vcs-branch")).toHaveTextContent("main"));
    await waitFor(() =>
      expect(screen.getByTestId("vcs-change")).toHaveTextContent("src/features/a.ts"),
    );

    // Back returns to the Files view.
    fireEvent.click(screen.getByTestId("changes-back"));
    expect(screen.queryByTestId("vcs-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("main-tab-files")).toHaveAttribute("aria-current", "true");
  });

  it("shows the branch chip in the status bar and updates it on vcs.branch.updated", async () => {
    const alpha = server({ id: "srv-m4vcsbar", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // The chip fetched GET /vcs on mount (branch from the store).
    await waitFor(() => expect(screen.getByTestId("status-bar-branch")).toHaveTextContent("main"));

    // A vcs.branch.updated SSE event updates the chip live.
    const handler = lastSseCall()[2] as (event: { type: string; properties?: unknown }) => void;
    handler({ type: "vcs.branch.updated", properties: { branch: "feat/x" } });
    await waitFor(() =>
      expect(screen.getByTestId("status-bar-branch")).toHaveTextContent("feat/x"),
    );
  });

  it("shows the connected LSP count and refreshes it on lsp.updated", async () => {
    const alpha = server({ id: "srv-m4lspbar", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    // The chip fetched GET /lsp on mount: two connected servers of three.
    await waitFor(() => expect(screen.getByTestId("status-bar-lsp")).toHaveTextContent("2"));

    // The server's LSP set changes; the lsp.updated event (empty payload,
    // verified EventLspUpdated) triggers a refetch of GET /lsp.
    lspStatus = [
      { id: "lsp_ts_01", name: "typescript-language-server", root: DEMO_DIR, status: "connected" },
      { id: "lsp_go_01", name: "gopls", root: DEMO_DIR, status: "error" },
    ];
    const handler = lastSseCall()[2] as (event: { type: string; properties?: unknown }) => void;
    handler({ type: "lsp.updated", properties: {} });
    await waitFor(() => expect(screen.getByTestId("status-bar-lsp")).toHaveTextContent("1"));
  });

  it("shows the enabled formatter names in the status bar", async () => {
    const alpha = server({ id: "srv-m4lspbar", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);

    // GET /formatter on mount: only the enabled formatter is shown.
    await waitFor(() =>
      expect(screen.getByTestId("status-bar-formatter")).toHaveTextContent("biome"),
    );
    expect(screen.getByTestId("status-bar-formatter")).not.toHaveTextContent("prettier");
  });

  it("shows the active session's tokens and cost, live on session.updated", async () => {
    const alpha = server({ id: "srv-m4usagebar", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // No active session: the usage chip stays hidden.
    expect(screen.queryByTestId("status-bar-usage")).not.toBeInTheDocument();

    const usageSession = {
      ...session("sess_usage_01", DEMO_DIR),
      tokens: { input: 1000, output: 500, reasoning: 200, cache: { read: 0, write: 0 } },
      cost: 0.042,
    };
    applySessionList("srv-m4usagebar", [usageSession]);
    setActiveSession("srv-m4usagebar", "sess_usage_01");
    // 1700 tokens -> "1.7K"; $0.042 -> "$0.04".
    await waitFor(() =>
      expect(screen.getByTestId("status-bar-usage")).toHaveTextContent("1.7K · $0.04"),
    );

    // A session.updated SSE event with new usage figures updates the chip.
    const handler = lastSseCall()[2] as (event: { type: string; properties?: unknown }) => void;
    handler({
      type: "session.updated",
      properties: {
        sessionID: "sess_usage_01",
        info: {
          ...usageSession,
          tokens: { input: 4000, output: 1000, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.11,
        },
      },
    });
    await waitFor(() =>
      expect(screen.getByTestId("status-bar-usage")).toHaveTextContent("5.0K · $0.11"),
    );
  });
});

describe("DesktopShell session share (TASK-M6-05)", () => {
  const SESSION_SHARE = "sess_share_01";

  async function openShareChat(serverId: string) {
    applySessionList(serverId, [session(SESSION_SHARE, DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId(`workspace-session-${SESSION_SHARE}`));
    await waitFor(() => expect(screen.getByTestId("chat-session-title")).toBeInTheDocument());
  }

  it("the chat header share icon opens the share dialog for the active session", async () => {
    const alpha = server({ id: "srv-m6share1", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openShareChat("srv-m6share1");

    expect(screen.getByTestId("session-share-toggle")).toHaveAttribute("data-shared", "false");
    fireEvent.click(screen.getByTestId("session-share-toggle"));

    const dialog = await screen.findByTestId("share-session-dialog");
    expect(dialog).toHaveTextContent(SESSION_SHARE);
    expect(screen.getByTestId("share-action")).toBeInTheDocument();
  });

  it("shares the active session from the header dialog and unshares it back", async () => {
    const alpha = server({ id: "srv-m6share2", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openShareChat("srv-m6share2");

    // Share: POST /session/{id}/share (no body) → URL + QR in the dialog.
    fireEvent.click(screen.getByTestId("session-share-toggle"));
    fireEvent.click(await screen.findByTestId("share-action"));

    const shareUrl = "https://share.opencode.dev/s/sess_share_01";
    await waitFor(() => expect(screen.getByTestId("share-url")).toHaveValue(shareUrl));
    await waitFor(() =>
      expect(screen.getByTestId("share-qr")).toHaveAttribute("src", "data:image/png;base64,QRDATA"),
    );
    const shareCalls = invokeMock.mock.calls.filter(
      (call) =>
        call[0] === "http_request" && /^\/session\/.+\/share$/.test(call[1].request?.path ?? ""),
    );
    expect(shareCalls).toHaveLength(1);
    expect(shareCalls[0][1].request.method).toBe("POST");
    // The header icon and the sidebar row reflect the shared state.
    await waitFor(() =>
      expect(screen.getByTestId("session-share-toggle")).toHaveAttribute("data-shared", "true"),
    );
    expect(
      within(screen.getByTestId(`workspace-session-${SESSION_SHARE}`)).getByTestId(
        "workspace-session-shared-badge",
      ),
    ).toBeInTheDocument();

    // Open in browser calls the opener plugin with the share URL.
    fireEvent.click(screen.getByTestId("share-open"));
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(shareUrl));

    // Unshare: DELETE /session/{id}/share → URL gone, badge gone.
    fireEvent.click(screen.getByTestId("share-unshare"));
    await waitFor(() => expect(screen.queryByTestId("share-url")).not.toBeInTheDocument());
    expect(getServerSessionState("srv-m6share2").sessions[SESSION_SHARE].share).toBeUndefined();
    await waitFor(() =>
      expect(
        within(screen.getByTestId(`workspace-session-${SESSION_SHARE}`)).queryByTestId(
          "workspace-session-shared-badge",
        ),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("session-share-toggle")).toHaveAttribute("data-shared", "false"),
    );
  });

  it("a shared session opens with the URL shown and the share icon marked", async () => {
    const alpha = server({ id: "srv-m6share3", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m6share3", [
      {
        ...session(SESSION_SHARE, DEMO_DIR),
        share: { url: "https://share.opencode.dev/s/sess_share_01" },
      },
    ]);
    fireEvent.click(await screen.findByTestId(`workspace-session-${SESSION_SHARE}`));
    await waitFor(() => expect(screen.getByTestId("chat-session-title")).toBeInTheDocument());

    expect(screen.getByTestId("session-share-toggle")).toHaveAttribute("data-shared", "true");
    fireEvent.click(screen.getByTestId("session-share-toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("share-url")).toHaveValue(
        "https://share.opencode.dev/s/sess_share_01",
      ),
    );
  });
});

describe("DesktopShell shortcut registry (TASK-M8-01)", () => {
  it("⌘N creates a new session through the registry action", async () => {
    const alpha = server({ id: "srv-m8new", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sessions["srv-m8new"]?.order).toEqual(["sess_demo_01"]));

    fireEvent.keyDown(window, { key: "n", metaKey: true });

    await waitFor(() =>
      expect(getServerSessionState("srv-m8new").activeSessionId).toBe("sess_new_01"),
    );
    expect(sessions["srv-m8new"]?.order).toContain("sess_new_01");
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
  });

  it("⌘B collapses and restores the sidebar", async () => {
    const alpha = server({ id: "srv-m8side", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("sidebar")).toHaveClass("hidden");

    // A second press (Ctrl on a non-mac test host) restores the sidebar.
    fireEvent.keyDown(window, { key: "B", ctrlKey: true });
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("sidebar")).not.toHaveClass("hidden");
  });

  it("the rail sidebar toggle collapses and restores the sidebar", async () => {
    const alpha = server({ id: "srv-m8sidebtn", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // Mouse affordance for the ⌘/Ctrl+B action (docs/ui-audit-2026-08 V4):
    // the collapsed sidebar must be restorable without the keyboard.
    const toggle = screen.getByTestId("rail-sidebar-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("sidebar")).not.toHaveClass("hidden");
  });

  it("⌘[ and ⌘] step through the session order with wrap-around", async () => {
    const alpha = server({ id: "srv-m8step", name: "Alpha" });
    // Mock the REST routes so the workspace tree can load: the roots list
    // and every per-directory sync return the same three sessions, keeping
    // the store order stable for the stepping assertions.
    invokeMock.mockImplementation((cmd: string, payload: unknown) => {
      if (cmd === "list_servers") return Promise.resolve([alpha]);
      if (cmd === "http_request") {
        const req = (payload as { request?: { path?: string } }).request;
        if (req?.path === "/project") {
          return Promise.resolve({ status: 200, headers: {}, body: [], bodyText: undefined });
        }
        if (req?.path === "/session") {
          return Promise.resolve({
            status: 200,
            headers: {},
            body: [
              session("sess_m8_a", DEMO_DIR),
              session("sess_m8_b", DEMO_DIR),
              session("sess_m8_c", DEMO_DIR),
            ],
            bodyText: undefined,
          });
        }
        return Promise.resolve({ status: 200, headers: {}, body: [], bodyText: undefined });
      }
      return Promise.resolve(undefined);
    });
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m8step", [
      session("sess_m8_a", DEMO_DIR),
      session("sess_m8_b", DEMO_DIR),
      session("sess_m8_c", DEMO_DIR),
    ]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_m8_a"));
    expect(getServerSessionState("srv-m8step").activeSessionId).toBe("sess_m8_a");

    fireEvent.keyDown(window, { key: "]", metaKey: true });
    expect(getServerSessionState("srv-m8step").activeSessionId).toBe("sess_m8_b");
    fireEvent.keyDown(window, { key: "[", metaKey: true });
    expect(getServerSessionState("srv-m8step").activeSessionId).toBe("sess_m8_a");
    // Wrap forward past the last session back to the first.
    fireEvent.keyDown(window, { key: "]", metaKey: true });
    fireEvent.keyDown(window, { key: "]", metaKey: true });
    fireEvent.keyDown(window, { key: "]", metaKey: true });
    expect(getServerSessionState("srv-m8step").activeSessionId).toBe("sess_m8_a");
  });

  it("⌘, opens the settings dialog and Esc closes it", async () => {
    const alpha = server({ id: "srv-m8settings", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: ",", metaKey: true });
    expect(screen.getByTestId("settings-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
    expect(screen.getByTestId("settings-section-shortcuts")).toBeInTheDocument();

    // Esc closes the modal settings dialog (its own keydown listener).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("settings-dialog")).not.toBeInTheDocument();
  });

  it("a customized combo replaces the default dispatch", async () => {
    const alpha = server({ id: "srv-m8custom", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    saveShortcutCombo("quickOpen", combo("e"));
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: "p", metaKey: true });
    expect(screen.queryByTestId("quick-open-dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "e", metaKey: true });
    expect(screen.getByTestId("quick-open-dialog")).toBeInTheDocument();
  });

  it("the active scope follows the focused main area", async () => {
    const alpha = server({ id: "srv-m8scope", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m8scope", [session("sess_m8_scope", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_m8_scope"));

    expect(screen.getByTestId("desktop-shell")).toHaveAttribute("data-active-scope", "global");
    fireEvent.focusIn(screen.getByTestId("prompt-input"));
    expect(screen.getByTestId("desktop-shell")).toHaveAttribute("data-active-scope", "chat");
    fireEvent.focusOut(screen.getByTestId("prompt-input"));
    expect(screen.getByTestId("desktop-shell")).toHaveAttribute("data-active-scope", "global");
    fireEvent.focusIn(screen.getByTestId("workspace-session-sess_m8_scope"));
    expect(screen.getByTestId("desktop-shell")).toHaveAttribute("data-active-scope", "list");
  });

  it("⌘K opens the command palette; Esc closes it (TASK-M8-02)", async () => {
    const alpha = server({ id: "srv-m8palette", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("command-palette-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("command-palette-input")).toHaveFocus();
    // The palette is the only dialog: QuickOpen stays inert.
    expect(screen.queryByTestId("quick-open-dialog")).not.toBeInTheDocument();

    // Esc closes the palette without executing anything.
    fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "Escape" });
    expect(screen.queryByTestId("command-palette-dialog")).not.toBeInTheDocument();

    // ⌘P still opens QuickOpen, not the palette (conflict-free pair).
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    expect(screen.getByTestId("quick-open-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("command-palette-dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("quick-open-input"), { key: "Escape" });
  });
});

describe("DesktopShell selected-text context menu (TASK-M8-03)", () => {
  // sess_revert_01 has a message route in mockHttpRoutes (msg_r1 renders).
  const SESSION_TEXT = "sess_revert_01";
  let writeTextMock: ReturnType<typeof vi.fn>;
  let selectionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
    selectionSpy = vi.spyOn(document, "getSelection").mockReturnValue({
      toString: () => "selected words",
    } as unknown as Selection);
  });

  afterEach(() => {
    selectionSpy.mockRestore();
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  async function openTextChat(serverId: string) {
    applySessionList(serverId, [session(SESSION_TEXT, DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId(`workspace-session-${SESSION_TEXT}`));
    await waitFor(() => expect(screen.getByTestId("message-msg_r1")).toBeInTheDocument());
  }

  it("right-click with a selection opens Copy / Quote in chat at the cursor", async () => {
    const alpha = server({ id: "srv-m8text", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openTextChat("srv-m8text");

    fireEvent.contextMenu(window, { clientX: 120, clientY: 130 });
    await waitFor(() => expect(screen.getByTestId("text-menu")).toBeInTheDocument());
    expect(screen.getByTestId("text-menu-copy")).toHaveTextContent("Copy");
    expect(screen.getByTestId("text-menu-quote")).toHaveTextContent("Quote in chat");
  });

  it("Copy writes the selection to the clipboard and closes", async () => {
    const alpha = server({ id: "srv-m8text2", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openTextChat("srv-m8text2");

    fireEvent.contextMenu(window, { clientX: 120, clientY: 130 });
    fireEvent.click(await screen.findByTestId("text-menu-copy"));

    expect(writeTextMock).toHaveBeenCalledWith("selected words");
    await waitFor(() => expect(screen.queryByTestId("text-menu")).not.toBeInTheDocument());
  });

  it("Quote in chat prefills the composer with a blockquote and focuses it", async () => {
    const alpha = server({ id: "srv-m8text3", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openTextChat("srv-m8text3");

    fireEvent.contextMenu(window, { clientX: 120, clientY: 130 });
    fireEvent.click(await screen.findByTestId("text-menu-quote"));

    const input = screen.getByTestId("prompt-input") as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toBe("> selected words"));
    expect(input).toHaveFocus();
  });

  it("does not open without a selection or when a message menu handled the event", async () => {
    const alpha = server({ id: "srv-m8text4", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openTextChat("srv-m8text4");

    // A message's own context menu prevents the default and wins.
    fireEvent.contextMenu(screen.getByTestId("message-msg_r1"), { clientX: 30, clientY: 40 });
    await waitFor(() => expect(screen.getByTestId("message-action")).toBeInTheDocument());
    expect(screen.queryByTestId("text-menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("message-action-backdrop"));

    // No selection: nothing opens.
    selectionSpy.mockReturnValue({ toString: () => "" } as unknown as Selection);
    fireEvent.contextMenu(window, { clientX: 120, clientY: 130 });
    expect(screen.queryByTestId("text-menu")).not.toBeInTheDocument();
  });

  it("right-click inside the open menu region does not reopen it", async () => {
    const alpha = server({ id: "srv-m8text5", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openTextChat("srv-m8text5");

    fireEvent.contextMenu(window, { clientX: 120, clientY: 130 });
    await waitFor(() => expect(screen.getByTestId("text-menu")).toBeInTheDocument());

    // A right-click on the menu's own backdrop suppresses the native menu
    // but must not open another text menu.
    fireEvent.contextMenu(screen.getByTestId("text-menu-backdrop"), { clientX: 60, clientY: 70 });
    expect(screen.getAllByTestId("text-menu")).toHaveLength(1);
  });

  it("Esc closes the text menu", async () => {
    const alpha = server({ id: "srv-m8text6", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    await openTextChat("srv-m8text6");

    fireEvent.contextMenu(window, { clientX: 120, clientY: 130 });
    await waitFor(() => expect(screen.getByTestId("text-menu")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("text-menu")).not.toBeInTheDocument());
  });
});

describe("DesktopShell file reference in chat (TASK-M8-03)", () => {
  it("the file tree's Reference in chat prefills the composer with @path", async () => {
    const alpha = server({ id: "srv-m8ref", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    applySessionList("srv-m8ref", [session("sess_ref_01", DEMO_DIR)]);
    fireEvent.click(await screen.findByTestId("workspace-session-sess_ref_01"));
    await waitFor(() => expect(screen.getByTestId("prompt-input")).toBeInTheDocument());

    // Switch the sidebar to the Files tree and right-click a file row.
    fireEvent.click(screen.getByTestId("sidebar-view-files"));
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId("file-row-README.md"), { clientX: 30, clientY: 40 });
    fireEvent.click(await screen.findByTestId("file-context-reference"));

    const input = screen.getByTestId("prompt-input") as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toBe("@README.md"));
  });
});

describe("DesktopShell tray & global summon (TASK-M8-05)", () => {
  function permissionRequest(id: string): PermissionRequest {
    return { id, sessionID: "s1", permission: "shell", patterns: [], metadata: {}, always: [] };
  }

  it("the tray menu's new-session event creates a session", async () => {
    const alpha = server({ id: "srv-m8tray", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sessions["srv-m8tray"]?.order).toEqual(["sess_demo_01"]));

    handlerFor("tray-new-session")(null);

    await waitFor(() =>
      expect(getServerSessionState("srv-m8tray").activeSessionId).toBe("sess_new_01"),
    );
    expect(sessions["srv-m8tray"]?.order).toContain("sess_new_01");
  });

  it("subscribes to the global summon event (the window is shown by Rust)", async () => {
    const alpha = server({ id: "srv-m8summon", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // The listener exists; firing it is safe and leaves the shell mounted.
    handlerFor("global-summon")(null);
    expect(screen.getByTestId("desktop-shell")).toBeInTheDocument();
  });

  it("syncs the pending permission count to the tray badge", async () => {
    const alpha = server({ id: "srv-m8badge", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // A zero count at mount is a no-op (setTrayBadge drops non-positive
    // counts; the badge is gone on restart anyway).
    expect(invokeMock).not.toHaveBeenCalledWith("tray_set_badge", { count: 0 });
    enqueue("srv-m8badge", permissionRequest("p1"));
    enqueue("srv-m8badge", permissionRequest("p2"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("tray_set_badge", { count: 2 }));
    resetPermissions("srv-m8badge");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("tray_set_badge", { count: 2 }));
  });

  it("re-applies persisted desktop prefs on mount", async () => {
    localStorage.setItem(
      "oc-desktop",
      JSON.stringify({ closeToTray: true, globalShortcut: "Ctrl+Shift+O" }),
    );
    const alpha = server({ id: "srv-m8prefs", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("set_close_to_tray", { enabled: true }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("set_global_shortcut", {
        accelerator: "Ctrl+Shift+O",
      }),
    );
    localStorage.removeItem("oc-desktop");
  });
});

describe("DesktopShell pet companion (TASK-M8-07)", () => {
  beforeEach(() => {
    showPetMock.mockClear();
  });

  it("shows the pet on mount when the pref is unset (default on)", async () => {
    const alpha = server({ id: "srv-m8pet1", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(showPetMock).toHaveBeenCalledTimes(1));
  });

  it("shows the pet on mount when the pref is enabled", async () => {
    localStorage.setItem("oc-desktop", JSON.stringify({ petEnabled: true }));
    const alpha = server({ id: "srv-m8pet2", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(showPetMock).toHaveBeenCalledTimes(1));
    localStorage.removeItem("oc-desktop");
  });

  it("does not show the pet on mount when the pref is disabled", async () => {
    localStorage.setItem("oc-desktop", JSON.stringify({ petEnabled: false }));
    const alpha = server({ id: "srv-m8pet3", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());
    expect(showPetMock).not.toHaveBeenCalled();
    localStorage.removeItem("oc-desktop");
  });
});

describe("DesktopShell system notifications (TASK-M8-06)", () => {
  it("mounts the notification watcher for the active server", async () => {
    const alpha = server({ id: "srv-m8n1", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(startNotificationsMock).toHaveBeenCalledWith("srv-m8n1"));
    expect(startNotificationsMock).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the notification watcher when the active server switches", async () => {
    const alpha = server({ id: "srv-m8n2", name: "Alpha" });
    const beta = server({ id: "srv-m8n3", name: "Beta" });
    invokeMock.mockResolvedValueOnce([alpha, beta]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(startNotificationsMock).toHaveBeenCalledWith("srv-m8n2"));
    const firstDispose = startNotificationsMock.mock.results[0]?.value as ReturnType<
      typeof startNotificationsMock
    >;
    fireEvent.click(await screen.findByTestId("rail-item-srv-m8n3"));
    await waitFor(() => expect(startNotificationsMock).toHaveBeenCalledWith("srv-m8n3"));
    // The stale server's watcher was torn down before the new one started.
    expect(firstDispose).toHaveBeenCalled();
  });

  it("subscribes to notification clicks and focuses the window", async () => {
    const alpha = server({ id: "srv-m8n4", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(subscribeToNotificationClickMock).toHaveBeenCalledTimes(1));
    const onClick = subscribeToNotificationClickMock.mock.calls[0]?.[0];
    expect(onClick).toBeTypeOf("function");
    onClick();
    await waitFor(() => expect(focusWindowMock).toHaveBeenCalledTimes(1));
  });
});

describe("DesktopShell pet watcher (TASK-M8-08)", () => {
  it("mounts the pet watcher for the active server", async () => {
    const alpha = server({ id: "srv-m8p1", name: "Alpha" });
    invokeMock.mockResolvedValueOnce([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(startPetWatcherMock).toHaveBeenCalledWith("srv-m8p1"));
    expect(startPetWatcherMock).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the pet watcher when the active server switches", async () => {
    const alpha = server({ id: "srv-m8p2", name: "Alpha" });
    const beta = server({ id: "srv-m8p3", name: "Beta" });
    invokeMock.mockResolvedValueOnce([alpha, beta]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(startPetWatcherMock).toHaveBeenCalledWith("srv-m8p2"));
    const firstDispose = startPetWatcherMock.mock.results[0]?.value as ReturnType<
      typeof startPetWatcherMock
    >;
    fireEvent.click(await screen.findByTestId("rail-item-srv-m8p3"));
    await waitFor(() => expect(startPetWatcherMock).toHaveBeenCalledWith("srv-m8p3"));
    // The stale server's watcher was torn down before the new one started.
    expect(firstDispose).toHaveBeenCalled();
  });
});

describe("DesktopShell server update hint (TASK-M8-09)", () => {
  it("shows the banner on installation.update-available and dismisses it", async () => {
    const alpha = server({ id: "srv-m8upd1", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    const handler = lastSseCall()[2] as (event: { type: string; properties?: unknown }) => void;
    handler({ type: "installation.update-available", properties: { version: "1.19.0" } });
    await waitFor(() => expect(screen.getByTestId("server-update-banner")).toBeInTheDocument());
    expect(screen.getByTestId("server-update-banner-text")).toHaveTextContent(
      "Server update available: v1.19.0",
    );
    expect(screen.getByTestId("server-update-banner-text")).toHaveTextContent(
      "restart opencode serve to apply",
    );

    fireEvent.click(screen.getByTestId("server-update-banner-dismiss"));
    expect(screen.queryByTestId("server-update-banner")).not.toBeInTheDocument();
  });

  it("omits the running version when the health snapshot never reported one", async () => {
    const alpha = server({ id: "srv-m8upd2", name: "Alpha" });
    mockHttpRoutes([alpha]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    const handler = lastSseCall()[2] as (event: { type: string; properties?: unknown }) => void;
    handler({ type: "installation.update-available", properties: { version: "1.19.0" } });
    await waitFor(() => expect(screen.getByTestId("server-update-banner")).toBeInTheDocument());
    expect(screen.getByTestId("server-update-banner-text")).not.toHaveTextContent("running v");
  });

  it("is per-server: the hint follows the active server", async () => {
    const alpha = server({ id: "srv-m8upd3", name: "Alpha" });
    const beta = server({ id: "srv-m8upd4", name: "Beta" });
    mockHttpRoutes([alpha, beta]);
    render(() => <DesktopShell server={alpha} onExit={vi.fn()} />);
    await waitFor(() => expect(sseSubscribeMock).toHaveBeenCalled());

    // Feed the event through ALPHA's stream (the first subscription).
    const alphaHandler = sseSubscribeMock.mock.calls[0]?.[2] as (event: {
      type: string;
      properties?: unknown;
    }) => void;
    alphaHandler({ type: "installation.update-available", properties: { version: "1.19.0" } });
    await waitFor(() => expect(screen.getByTestId("server-update-banner")).toBeInTheDocument());

    // Beta has no hint: the banner disappears while it is active.
    fireEvent.click(await screen.findByTestId("rail-item-srv-m8upd4"));
    await waitFor(() =>
      expect(screen.queryByTestId("server-update-banner")).not.toBeInTheDocument(),
    );

    // Back to Alpha: the persisted hint returns.
    fireEvent.click(screen.getByTestId("rail-item-srv-m8upd3"));
    await waitFor(() => expect(screen.getByTestId("server-update-banner")).toBeInTheDocument());
  });
});
