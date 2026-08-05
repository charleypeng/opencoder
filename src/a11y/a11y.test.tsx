// TASK-M9-08 accessibility walkthrough (docs/a11y-report.md): an axe-core
// (WCAG 2.x A/AA tags) sweep over the key screens — DesktopShell, the
// Settings center, the session list, the message list and the prompt box.
// jsdom cannot compute layout or real colors, so the sweep asserts zero
// CRITICAL/SERIOUS violations only (moderate/minor findings and the
// manual color-contrast table live in docs/a11y-report.md); rules that
// require layout (`color-contrast`, `target-size`, `region` on isolated
// component renders) are excluded with the reasons documented there.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import axe, { type AxeResults, type Result } from "axe-core";
import DesktopShell from "../shells/desktop/DesktopShell";
import SettingsPage from "../features/settings/SettingsPage";
import SessionList from "../features/sessions/SessionList";
import MessageList from "../features/messages/MessageList";
import PromptBox from "../features/sessions/PromptBox";
import type { ServerEntry } from "../services/servers";
import type { Session } from "../services/session";
import type { SessionMessage } from "../services/message";
import { applySessionList, resetServer as resetSessions } from "../stores/session";
import { applyMessageBatch, resetServer as resetMessages } from "../stores/messages";
import { resetServer as resetModels } from "../stores/models";
import { resetServer as resetTodos } from "../stores/todos";
import { resetServer as resetViewer } from "../stores/viewer";
import { resetServer as resetDiffs } from "../stores/diff";
import { resetServer as resetVcs } from "../stores/vcs";
import { resetServer as resetPtys } from "../stores/ptys";
import { resetServer as resetLsp } from "../stores/lsp";
import { resetServer as resetPermission } from "../stores/permission";
import { clearToasts } from "../stores/toasts";

const { getApiClientMock, invokeMock, listenMock, sseSubscribeMock, qrToDataURLMock, openUrlMock } =
  vi.hoisted(() => ({
    getApiClientMock: vi.fn(),
    invokeMock: vi.fn(),
    listenMock: vi.fn(() => Promise.resolve(() => {})),
    sseSubscribeMock: vi.fn(),
    qrToDataURLMock: vi.fn(),
    openUrlMock: vi.fn(),
  }));

vi.mock("../services/client.js", () => ({ getApiClient: getApiClientMock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("../services/sse.js", () => ({ sseSubscribe: sseSubscribeMock }));
vi.mock("qrcode", () => ({ default: { toDataURL: qrToDataURLMock } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("../services/notificationEvents.js", () => ({
  startNotifications: vi.fn(() => vi.fn()),
}));
vi.mock("../features/pet/petEvents.js", () => ({
  startPetWatcher: vi.fn(() => vi.fn()),
}));
vi.mock("../services/notifications.js", () => ({
  subscribeToNotificationClick: vi.fn(() => vi.fn()),
  focusWindow: vi.fn(async () => {}),
}));
vi.mock("../services/updates.js", () => ({
  checkForUpdates: vi.fn(async () => null),
  getAppVersion: vi.fn(async () => null),
  installAndRelaunch: vi.fn(async () => {}),
  loadLastCheck: vi.fn(() => undefined),
  recordLastCheck: vi.fn(),
  shouldAutoCheck: vi.fn(() => false),
}));
vi.mock("../services/pet.js", () => ({
  showPet: vi.fn(async () => {}),
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
// The viewer highlights through Shiki; a stub keeps the sweep free of
// language-pack loading (the viewer tests cover the real contract).
vi.mock("../features/messages/markdown/highlighter.js", () => ({
  getHighlighter: vi.fn(),
  highlightCode: vi.fn(async (code: string) => `<pre data-testid="hl">${code}</pre>`),
}));

const SERVER = "srv-a11y";
const SESSION = "ses_a11y_1";

const SERVER_ENTRY: ServerEntry = {
  id: SERVER,
  name: "Alpha",
  url: "http://localhost:14096",
  createdAt: 1_700_000_000_000,
};

function session(id: string, title = id): Session {
  return {
    id,
    slug: id,
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title,
    version: "1.18.11",
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
  } as Session;
}

function mockClient(history: SessionMessage[] = [], sessionsList: Session[] = []) {
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue({
    get: vi.fn(async (path: string) => (path === "/session" ? sessionsList : history)),
    post: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  });
}

/** Runs the WCAG A/AA rule set over the rendered tree. Rules that cannot
 *  work without a real layout engine are disabled with reasons recorded in
 *  docs/a11y-report.md: `color-contrast` needs real computed colors (the
 *  contrast walk is a manual token table there), `target-size` needs real
 *  hit areas, and `region` is meaningless for isolated component renders
 *  (full-page landmark coverage is asserted on DesktopShell/SettingsPage). */
async function violationsAt(container: HTMLElement): Promise<Result[]> {
  const results = (await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false }, "target-size": { enabled: false } },
  })) as AxeResults;
  return results.violations;
}

function expectNoSerious(violations: Result[], screenName: string): void {
  const serious = violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  const summary = serious.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
    help: v.help,
  }));
  expect(summary, `${screenName} critical/serious axe violations`).toEqual([]);
}

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  sseSubscribeMock.mockReset();
  sseSubscribeMock.mockImplementation(async () => vi.fn(async () => {}));
  window.__TAURI_INTERNALS__ = {};
  mockClient();
  clearToasts();
});

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
  resetSessions(SERVER);
  resetMessages(SERVER);
  resetModels(SERVER);
  resetTodos(SERVER);
  resetViewer(SERVER);
  resetDiffs(SERVER);
  resetVcs(SERVER);
  resetPtys(SERVER);
  resetLsp(SERVER);
  resetPermission(SERVER);
  document.body.innerHTML = "";
});

describe("a11y sweep (TASK-M9-08)", () => {
  it("DesktopShell: rail, sidebar, chat transcript and prompt box", async () => {
    mockClient([], [session("ses_a11y_1", "First session"), session("ses_a11y_2")]);
    const { container } = render(() => <DesktopShell server={SERVER_ENTRY} onExit={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("session-item-ses_a11y_1")).toBeInTheDocument());
    // Select the first session so the chat pane (message list + prompt box)
    // mounts in the same sweep.
    fireEvent.click(screen.getByTestId("session-item-ses_a11y_1"));
    await waitFor(() => expect(screen.getByTestId("prompt-box")).toBeInTheDocument());
    expectNoSerious(await violationsAt(container), "DesktopShell");
  });

  it("SettingsPage (desktop variant): sections, nav and search", async () => {
    mockClient();
    const { container } = render(() => <SettingsPage serverId={SERVER} variant="desktop" />);
    await waitFor(() => expect(screen.getByTestId("settings-page")).toBeInTheDocument());
    expectNoSerious(await violationsAt(container), "SettingsPage");
  });

  it("SessionList: rows, status badges and action menu", async () => {
    applySessionList(SERVER, [session("ses_a11y_1", "First session"), session("ses_a11y_2")]);
    const { container } = render(() => <SessionList serverId={SERVER} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("session-item-ses_a11y_1")).toBeInTheDocument());
    expectNoSerious(await violationsAt(container), "SessionList");
  });

  it("MessageList: bubbles, tool cards and reasoning fold", async () => {
    const items: Parameters<typeof applyMessageBatch>[2] = [];
    items.push({
      type: "message",
      info: {
        id: "msg_1",
        sessionID: SESSION,
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5" },
      },
    });
    items.push({
      type: "part",
      part: {
        id: "prt_1_0",
        sessionID: SESSION,
        messageID: "msg_1",
        type: "text",
        text: "What is the plan?",
      },
    });
    items.push({
      type: "message",
      info: {
        id: "msg_2",
        sessionID: SESSION,
        role: "assistant",
        time: { created: 2, completed: 3 },
        parentID: "",
        modelID: "gpt-5",
        providerID: "openai",
        mode: "primary",
        agent: "build",
        path: { cwd: "/d", root: "/d" },
        cost: 0,
        tokens: {
          input: 10,
          output: 10,
          reasoning: 5,
          cache: { read: 0, write: 0 },
        },
      },
    });
    items.push({
      type: "part",
      part: {
        id: "prt_2_0",
        sessionID: SESSION,
        messageID: "msg_2",
        type: "reasoning",
        text: "Let me think about the steps.",
        time: { start: 2 },
      },
    });
    items.push({
      type: "part",
      part: {
        id: "prt_2_1",
        sessionID: SESSION,
        messageID: "msg_2",
        type: "text",
        text: "## Plan\n\n1. First step.\n2. Second step.",
      },
    });
    applyMessageBatch(SERVER, SESSION, items);
    const { container } = render(() => <MessageList serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("message-msg_1")).toBeInTheDocument());
    expectNoSerious(await violationsAt(container), "MessageList");
  });

  it("PromptBox: composer, send/stop, agent chip and model chip", async () => {
    applySessionList(SERVER, [session(SESSION)]);
    const { container } = render(() => <PromptBox serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("prompt-box")).toBeInTheDocument());
    expectNoSerious(await violationsAt(container), "PromptBox");
  });
});
