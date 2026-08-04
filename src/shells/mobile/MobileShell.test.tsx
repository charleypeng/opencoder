// L2 tests for the mobile shell (TASK-M7-03): four tabs render, tab
// switching preserves state (hidden tabs stay mounted, stacks survive),
// the push stack flows session list -> chat -> back, native-glass mode
// (iOS + glass bridge) hides the web nav and routes native taps, and the
// web nav is the fallback on Android / bridge-less iOS. TASK-M7-04 adds
// the safe-area classes (pb-safe-bar / pb-safe) and the native bar
// visibility lifecycle: the shell shows the bar on mount and hides it on
// unmount through the glass bridge's setHidden message. TASK-M7-05 mounts
// the permission and question sheets in their mobile presentation.
// TASK-M7-07: the keyed page wrapper carries the enter transition class
// (push = forward, pop = back, mount = none) and the shell mounts the
// haptic watcher (a generating session turning idle fires the complete
// haptic through the mocked facade).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import MobileShell from "./MobileShell";
import { refreshPlatform } from "../../platform";
import { resetNav } from "./navigation";
import {
  applySessionList,
  resetServer as resetSessions,
  setSessionStatus,
} from "../../stores/session";
import { resetServer as resetMessages } from "../../stores/messages";
import {
  dequeue as dequeuePermission,
  enqueue as enqueuePermission,
  resetServer as resetPermissionStore,
} from "../../stores/permission";
import {
  dequeue as dequeueQuestion,
  enqueue as enqueueQuestion,
  resetServer as resetQuestionStore,
} from "../../stores/question";
import type { Session } from "../../services/session";
import type { ServerEntry } from "../../services/servers";

const { invokeMock, hapticMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  hapticMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
// TASK-M7-07: the haptic facade is mocked so the shell-level watcher mount
// can be asserted (the facade's own guard/dispatch is covered in
// src/services/haptics.test.ts).
vi.mock("../../services/haptics.js", () => ({ haptic: hapticMock }));
// MessageBubble renders through Shiki; the stub keeps the shell tests free
// of language-pack loading (the viewer tests cover the real contract).
vi.mock("../../features/messages/markdown/highlighter.js", () => ({
  getHighlighter: vi.fn(),
  highlightCode: vi.fn(async (code: string) => `<pre data-testid="hl">${code}</pre>`),
}));

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const ORIGINAL_UA = window.navigator.userAgent;

const SERVER: ServerEntry = {
  id: "srv-mobile",
  name: "Alpha",
  url: "http://localhost:14096",
  createdAt: 1_700_000_000_000,
};

function session(id: string): Session {
  return {
    id,
    slug: id,
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: id,
    version: "1.18.11",
    time: { created: 1, updated: 1 },
  } as Session;
}

function httpResponse(body: unknown) {
  return { status: 200, headers: {}, body, bodyText: undefined };
}

// The glassBridge postMessage stub of the currently stubbed environment
// (undefined when no bridge is installed).
let bridgePostMessage: ReturnType<typeof vi.fn> | undefined;

/** Sets the environment to a mobile platform and re-resolves platform. */
function stubPlatform(userAgent: string, bridge: boolean): void {
  Object.defineProperty(window.navigator, "userAgent", { value: userAgent, configurable: true });
  if (bridge) {
    bridgePostMessage = vi.fn();
    Object.defineProperty(window, "webkit", {
      value: { messageHandlers: { glassBridge: { postMessage: bridgePostMessage } } },
      configurable: true,
    });
  } else {
    bridgePostMessage = undefined;
    delete window.webkit;
  }
  refreshPlatform();
}

function stubAndroid(): void {
  stubPlatform(ANDROID_UA, false);
}

function stubIOS(bridge: boolean): void {
  stubPlatform(IPHONE_UA, bridge);
}

beforeEach(() => {
  invokeMock.mockImplementation((cmd: string) => {
    // Message history / any other REST call: an empty payload keeps the
    // transcript and shell quiet (the shell tests focus on navigation).
    if (cmd === "http_request") return Promise.resolve(httpResponse([]));
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  Object.defineProperty(window.navigator, "userAgent", { value: ORIGINAL_UA, configurable: true });
  delete window.webkit;
  delete window.__glassTabSelected;
  bridgePostMessage = undefined;
  refreshPlatform();
  resetNav();
  resetSessions(SERVER.id);
  resetMessages(SERVER.id);
  resetPermissionStore(SERVER.id);
  resetQuestionStore(SERVER.id);
  vi.clearAllMocks();
});

function renderShell() {
  return render(() => <MobileShell server={SERVER} onExit={vi.fn()} />);
}

describe("MobileShell", () => {
  it("renders four web-nav tabs and starts on Sessions (Android)", async () => {
    stubAndroid();
    renderShell();
    await waitFor(() => screen.getByTestId("mobile-shell"));

    expect(screen.getByTestId("mobile-shell")).toHaveAttribute("data-native-glass", "false");
    const nav = screen.getByTestId("mobile-nav");
    expect(nav).not.toHaveClass("hidden");
    for (const tab of ["sessions", "files", "terminal", "settings"]) {
      expect(screen.getByTestId(`mobile-tab-${tab}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("mobile-page-sessions")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("mobile-page-files")).toHaveAttribute("data-active", "false");
  });

  it("switches tabs with the web nav, keeping hidden tabs mounted", async () => {
    stubAndroid();
    renderShell();
    await waitFor(() => screen.getByTestId("mobile-tab-files"));

    fireEvent.click(screen.getByTestId("mobile-tab-files"));
    await waitFor(() =>
      expect(screen.getByTestId("mobile-page-files")).toHaveAttribute("data-active", "true"),
    );
    // The sessions tab is still mounted (keep-alive), just hidden.
    const sessionsPage = screen.getByTestId("mobile-page-sessions");
    expect(sessionsPage).toHaveAttribute("data-active", "false");
    expect(sessionsPage).toHaveClass("hidden");
    // Every tab root stays in the document.
    for (const tab of ["sessions", "files", "terminal", "settings"]) {
      expect(screen.getByTestId(`mobile-page-${tab}`)).toBeInTheDocument();
    }
    // The active page wrapper is NOT hidden.
    expect(screen.getByTestId("mobile-page-files")).not.toHaveClass("hidden");
  });

  it("preserves per-tab navigation state across switches", async () => {
    stubAndroid();
    applySessionList(SERVER.id, [session("sess_1")]);
    renderShell();
    await waitFor(() => screen.getByTestId("session-row-sess_1"));

    // Push chat inside the Sessions tab.
    fireEvent.click(screen.getByTestId("session-row-sess_1"));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("mobile-page-sessions")).getByTestId("mobile-page-chat"),
      ).toBeInTheDocument(),
    );

    // Switch away and back: the pushed chat page is still there.
    fireEvent.click(screen.getByTestId("mobile-tab-terminal"));
    await waitFor(() =>
      expect(screen.getByTestId("mobile-page-terminal")).toHaveAttribute("data-active", "true"),
    );
    expect(
      within(screen.getByTestId("mobile-page-sessions")).getByTestId("mobile-page-chat"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mobile-tab-sessions"));
    await waitFor(() =>
      expect(screen.getByTestId("mobile-page-sessions")).toHaveAttribute("data-active", "true"),
    );
    expect(
      within(screen.getByTestId("mobile-page-sessions")).getByTestId("mobile-page-chat"),
    ).toBeInTheDocument();
  });

  it("pushes session list -> chat and pops back", async () => {
    stubAndroid();
    applySessionList(SERVER.id, [session("sess_1"), session("sess_2")]);
    renderShell();
    await waitFor(() => screen.getByTestId("session-row-sess_1"));

    fireEvent.click(screen.getByTestId("session-row-sess_2"));
    const sessionsTab = screen.getByTestId("mobile-page-sessions");
    await waitFor(() =>
      expect(within(sessionsTab).getByTestId("mobile-page-chat")).toBeInTheDocument(),
    );
    expect(within(sessionsTab).getByTestId("mobile-page-title")).toHaveTextContent("sess_2");

    fireEvent.click(within(sessionsTab).getByTestId("page-back"));
    await waitFor(() =>
      expect(within(sessionsTab).queryByTestId("mobile-page-chat")).not.toBeInTheDocument(),
    );
    // Back on the root page is a no-op: sessions rows still render.
    fireEvent.click(within(sessionsTab).getByTestId("page-back"));
    await waitFor(() => expect(screen.getByTestId("session-row-sess_1")).toBeInTheDocument());
  });

  it("applies the enter transition classes on push and pop (TASK-M7-07)", async () => {
    stubAndroid();
    applySessionList(SERVER.id, [session("sess_1")]);
    renderShell();
    await waitFor(() => screen.getByTestId("session-row-sess_1"));

    // Initial mount: no enter animation class.
    const sessionsTab = screen.getByTestId("mobile-page-sessions");
    expect(within(sessionsTab).getByTestId("mobile-page-route-sessions")).not.toHaveClass(
      "page-enter-forward",
    );
    expect(within(sessionsTab).getByTestId("mobile-page-route-sessions")).not.toHaveClass(
      "page-enter-back",
    );

    // Push: the incoming page wrapper slides in from the right.
    fireEvent.click(screen.getByTestId("session-row-sess_1"));
    await waitFor(() =>
      expect(within(sessionsTab).getByTestId("mobile-page-chat")).toBeInTheDocument(),
    );
    expect(within(sessionsTab).getByTestId("mobile-page-route-sessions")).toHaveClass(
      "page-enter-forward",
    );

    // Pop: the incoming page wrapper slides in from the left.
    fireEvent.click(within(sessionsTab).getByTestId("page-back"));
    await waitFor(() =>
      expect(within(sessionsTab).queryByTestId("mobile-page-chat")).not.toBeInTheDocument(),
    );
    expect(within(sessionsTab).getByTestId("mobile-page-route-sessions")).toHaveClass(
      "page-enter-back",
    );
  });

  it("mounts the haptic watcher: completion of a generating session fires the complete haptic (TASK-M7-07)", async () => {
    stubAndroid();
    applySessionList(SERVER.id, [session("sess_1")]);
    renderShell();
    await waitFor(() => screen.getByTestId("session-row-sess_1"));

    setSessionStatus(SERVER.id, "sess_1", { type: "busy" });
    setSessionStatus(SERVER.id, "sess_1", { type: "idle" });
    await waitFor(() => expect(hapticMock).toHaveBeenCalledWith("complete"));
  });

  it("pops the chat page with an edge right-swipe (TASK-M7-06)", async () => {
    stubAndroid();
    applySessionList(SERVER.id, [session("sess_1")]);
    renderShell();
    await waitFor(() => screen.getByTestId("session-row-sess_1"));

    fireEvent.click(screen.getByTestId("session-row-sess_1"));
    const sessionsTab = screen.getByTestId("mobile-page-sessions");
    await waitFor(() =>
      expect(within(sessionsTab).getByTestId("mobile-page-chat")).toBeInTheDocument(),
    );

    // A rightward drag from the left edge (~24px zone) past ~40px pops.
    const chat = within(sessionsTab).getByTestId("mobile-page-chat");
    fireEvent.pointerDown(chat, { clientX: 10, clientY: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 200 });
    fireEvent.pointerUp(window, { clientX: 90, clientY: 200 });
    await waitFor(() =>
      expect(within(sessionsTab).queryByTestId("mobile-page-chat")).not.toBeInTheDocument(),
    );
    // The sessions list is back.
    expect(screen.getByTestId("session-row-sess_1")).toBeInTheDocument();
  });

  it("an edge swipe starting outside the zone does not pop (TASK-M7-06)", async () => {
    stubAndroid();
    applySessionList(SERVER.id, [session("sess_1")]);
    renderShell();
    await waitFor(() => screen.getByTestId("session-row-sess_1"));

    fireEvent.click(screen.getByTestId("session-row-sess_1"));
    const sessionsTab = screen.getByTestId("mobile-page-sessions");
    await waitFor(() =>
      expect(within(sessionsTab).getByTestId("mobile-page-chat")).toBeInTheDocument(),
    );

    const chat = within(sessionsTab).getByTestId("mobile-page-chat");
    fireEvent.pointerDown(chat, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 200 });
    await waitFor(() =>
      expect(within(sessionsTab).getByTestId("mobile-page-chat")).toBeInTheDocument(),
    );
  });

  it("lists sessions with empty state", async () => {
    stubAndroid();
    renderShell();
    await waitFor(() => screen.getByTestId("sessions-empty"));
    expect(screen.getByTestId("sessions-empty")).toHaveTextContent("No sessions yet");
  });

  it("routes native glass tab taps through selectTab (iOS + bridge)", async () => {
    stubIOS(true);
    renderShell();
    await waitFor(() => screen.getByTestId("mobile-shell"));

    // Native mode: web nav hidden, content reserves space for the native bar
    // (bar height + home-indicator inset, TASK-M7-04).
    expect(screen.getByTestId("mobile-shell")).toHaveAttribute("data-native-glass", "true");
    expect(screen.getByTestId("mobile-nav")).toHaveClass("hidden");
    expect(screen.getByTestId("mobile-content")).toHaveClass("pb-safe-bar");

    // Native -> web tap (0-based index, matching UITabBar item order).
    await waitFor(() => {
      window.__glassTabSelected?.(1);
      expect(screen.getByTestId("mobile-page-files")).toHaveAttribute("data-active", "true");
    });
    await waitFor(() => {
      window.__glassTabSelected?.(3);
      expect(screen.getByTestId("mobile-page-settings")).toHaveAttribute("data-active", "true");
    });
  });

  it("shows the native glass bar on mount and hides it on unmount", async () => {
    stubIOS(true);
    const view = renderShell();
    await waitFor(() => screen.getByTestId("mobile-shell"));

    // Workspace owns the bottom edge: the bar is shown on mount...
    expect(bridgePostMessage).toHaveBeenCalledWith({ type: "setHidden", hidden: false });

    // ...and hidden again when leaving back to the servers home.
    view.unmount();
    expect(bridgePostMessage).toHaveBeenCalledWith({ type: "setHidden", hidden: true });
  });

  it("pads the web nav with the home-indicator inset (Android)", async () => {
    stubAndroid();
    renderShell();
    await waitFor(() => screen.getByTestId("mobile-shell"));

    expect(screen.getByTestId("mobile-nav")).toHaveClass("pb-safe");
  });

  it("falls back to the web nav on iOS without the glass bridge", async () => {
    stubIOS(false);
    renderShell();
    await waitFor(() => screen.getByTestId("mobile-shell"));

    expect(screen.getByTestId("mobile-shell")).toHaveAttribute("data-native-glass", "false");
    expect(screen.getByTestId("mobile-nav")).not.toHaveClass("hidden");
    expect(screen.getByTestId("mobile-content")).not.toHaveClass("pb-safe-bar");

    fireEvent.click(screen.getByTestId("mobile-tab-terminal"));
    await waitFor(() =>
      expect(screen.getByTestId("mobile-page-terminal")).toHaveAttribute("data-active", "true"),
    );
  });

  it("mounts the permission and question sheets in the mobile presentation", async () => {
    stubAndroid();
    enqueuePermission(SERVER.id, {
      id: "per_mobile_1",
      sessionID: "sess_1",
      permission: "bash",
      patterns: ["pnpm test"],
      metadata: {},
      always: [],
    });
    enqueueQuestion(SERVER.id, {
      id: "que_mobile_1",
      sessionID: "sess_1",
      questions: [
        {
          question: "Which approach?",
          header: "Approach",
          options: [{ label: "A", description: "" }],
        },
      ],
    });
    renderShell();
    await waitFor(() => screen.getByTestId("mobile-shell"));

    // Both queues surface as bottom sheets pinned inside the shell.
    await waitFor(() => expect(screen.getByTestId("permission-sheet")).toBeInTheDocument());
    expect(screen.getByTestId("permission-type")).toHaveTextContent("bash");
    await waitFor(() => expect(screen.getByTestId("question-sheet")).toBeInTheDocument());
    expect(screen.getByTestId("question-text")).toHaveTextContent("Which approach?");

    // Draining the queues (the replied/rejected event path) hides both.
    dequeuePermission(SERVER.id, "per_mobile_1");
    dequeueQuestion(SERVER.id, "que_mobile_1");
    await waitFor(() => expect(screen.queryByTestId("permission-sheet")).toBeNull());
    expect(screen.queryByTestId("question-sheet")).toBeNull();
  });
});
