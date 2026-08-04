// L2 tests for the mobile shell (TASK-M7-03): four tabs render, tab
// switching preserves state (hidden tabs stay mounted, stacks survive),
// the push stack flows session list -> chat -> back, native-glass mode
// (iOS + glass bridge) hides the web nav and routes native taps, and the
// web nav is the fallback on Android / bridge-less iOS.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import MobileShell from "./MobileShell";
import { refreshPlatform } from "../../platform";
import { resetNav } from "./navigation";
import { applySessionList, resetServer as resetSessions } from "../../stores/session";
import { resetServer as resetMessages } from "../../stores/messages";
import type { Session } from "../../services/session";
import type { ServerEntry } from "../../services/servers";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
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

/** Sets the environment to a mobile platform and re-resolves platform. */
function stubPlatform(userAgent: string, bridge: boolean): void {
  Object.defineProperty(window.navigator, "userAgent", { value: userAgent, configurable: true });
  if (bridge) {
    Object.defineProperty(window, "webkit", {
      value: { messageHandlers: { glassBridge: { postMessage: vi.fn() } } },
      configurable: true,
    });
  } else {
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
  refreshPlatform();
  resetNav();
  resetSessions(SERVER.id);
  resetMessages(SERVER.id);
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

    // Native mode: web nav hidden, content reserves space for the native bar.
    expect(screen.getByTestId("mobile-shell")).toHaveAttribute("data-native-glass", "true");
    expect(screen.getByTestId("mobile-nav")).toHaveClass("hidden");
    expect(screen.getByTestId("mobile-content")).toHaveClass("pb-20");

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

  it("falls back to the web nav on iOS without the glass bridge", async () => {
    stubIOS(false);
    renderShell();
    await waitFor(() => screen.getByTestId("mobile-shell"));

    expect(screen.getByTestId("mobile-shell")).toHaveAttribute("data-native-glass", "false");
    expect(screen.getByTestId("mobile-nav")).not.toHaveClass("hidden");
    expect(screen.getByTestId("mobile-content")).not.toHaveClass("pb-20");

    fireEvent.click(screen.getByTestId("mobile-tab-terminal"));
    await waitFor(() =>
      expect(screen.getByTestId("mobile-page-terminal")).toHaveAttribute("data-active", "true"),
    );
  });
});
