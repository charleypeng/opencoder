// L2 tests for the mobile Terminal flow (TASK-M7-09): the Terminal tab
// renders the real terminal panel in its mobile variant — the aux key
// strip appears under the instances and routes key sequences into the
// active instance's PTY channel, the double-tap font zoom works on the
// instance, and the page root carries the landscape fullscreen class.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import MobileShell from "./MobileShell";
import { refreshPlatform } from "../../platform";
import { resetNav } from "./navigation";
import { resetServer as resetPtys, upsertPty } from "../../stores/ptys";
import { resetServer as resetSessions } from "../../stores/session";
import { resetServer as resetMessages } from "../../stores/messages";
import { resetServer as resetPermissionStore } from "../../stores/permission";
import { resetServer as resetQuestionStore } from "../../stores/question";
import type { Pty } from "../../services/pty";
import type { ServerEntry } from "../../services/servers";

const { invokeMock, ptyConnectMock, ptySendMock, TerminalMock, FitAddonMock, terminalInstances } =
  vi.hoisted(() => {
    const terminalInstances: { options: Record<string, unknown> }[] = [];
    class TerminalMock {
      options: Record<string, unknown> = {};
      open = vi.fn();
      loadAddon = vi.fn();
      dispose = vi.fn();
      onData = vi.fn(() => ({ dispose: vi.fn() }));
      onResize = vi.fn(() => ({ dispose: vi.fn() }));
      write = vi.fn();
      constructor(options?: Record<string, unknown>) {
        this.options = options ?? {};
        terminalInstances.push(this);
      }
    }
    class FitAddonMock {
      fit = vi.fn();
      activate = vi.fn();
      proposeDimensions = vi.fn();
      dispose = vi.fn();
    }
    return {
      invokeMock: vi.fn(),
      ptyConnectMock: vi.fn(),
      ptySendMock: vi.fn(),
      TerminalMock,
      FitAddonMock,
      terminalInstances,
    };
  });

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../../services/haptics.js", () => ({ haptic: vi.fn() }));
vi.mock("../../services/ptyWs.js", () => ({
  ptyConnect: ptyConnectMock,
  ptySend: ptySendMock,
}));
vi.mock("@xterm/xterm", () => ({ Terminal: TerminalMock }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: FitAddonMock }));

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const ORIGINAL_UA = window.navigator.userAgent;

const SERVER: ServerEntry = {
  id: "srv-terminal-mobile",
  name: "Alpha",
  url: "http://localhost:14096",
  createdAt: 1_700_000_000_000,
};

function pty(id: string): Pty {
  return {
    id,
    title: `terminal ${id}`,
    command: "sh",
    args: [],
    cwd: "/mock/projects/opencode-demo",
    status: "running",
    pid: 1000,
  } as Pty;
}

function httpResponse(body: unknown) {
  return { status: 200, headers: {}, body, bodyText: undefined };
}

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
  // The callback is intentionally ignored: the stub only needs the API
  // surface for the terminal's ResizeObserver wiring.
}

function stubAndroid(): void {
  Object.defineProperty(window.navigator, "userAgent", { value: ANDROID_UA, configurable: true });
  delete window.webkit;
  refreshPlatform();
}

beforeEach(() => {
  stubAndroid();
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "http_request") return Promise.resolve(httpResponse([]));
    return Promise.resolve(undefined);
  });
  ptyConnectMock.mockImplementation(async (_serverId: string, ptyId: string) => {
    return { connectionId: ptyId === "pty_1" ? 1 : 2, close: vi.fn(async () => {}) };
  });
});

afterEach(() => {
  Object.defineProperty(window.navigator, "userAgent", { value: ORIGINAL_UA, configurable: true });
  delete window.webkit;
  vi.unstubAllGlobals();
  refreshPlatform();
  resetNav();
  resetPtys(SERVER.id);
  resetSessions(SERVER.id);
  resetMessages(SERVER.id);
  resetPermissionStore(SERVER.id);
  resetQuestionStore(SERVER.id);
  vi.clearAllMocks();
});

async function openTerminalTab(): Promise<void> {
  upsertPty(SERVER.id, pty("pty_1"));
  render(() => <MobileShell server={SERVER} onExit={vi.fn()} />);
  fireEvent.click(screen.getByTestId("mobile-tab-terminal"));
  await waitFor(() =>
    expect(screen.getByTestId("mobile-page-terminal")).toHaveAttribute("data-active", "true"),
  );
  await waitFor(() =>
    expect(ptyConnectMock).toHaveBeenCalledWith(SERVER.id, "pty_1", expect.any(Object)),
  );
  // Let the connect promises' .then callbacks (connection assignment) land.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("mobile Terminal flow (TASK-M7-09)", () => {
  it("renders the terminal page with the landscape fullscreen class", async () => {
    upsertPty(SERVER.id, pty("pty_1"));
    render(() => <MobileShell server={SERVER} onExit={vi.fn()} />);
    fireEvent.click(screen.getByTestId("mobile-tab-terminal"));
    await waitFor(() =>
      expect(screen.getByTestId("mobile-page-terminal")).toHaveAttribute("data-active", "true"),
    );

    // TASK-M9-08: the terminal page is lazy-loaded (xterm chunk), so the
    // panel appears after the dynamic import resolves.
    await waitFor(() => expect(screen.getByTestId("terminal-panel")).toBeInTheDocument());
    const page = screen.getByTestId("mobile-page-terminal-root");
    expect(page).toHaveClass("landscape-terminal");
  });

  it("routes strip keys into the active instance's PTY channel", async () => {
    await openTerminalTab();
    expect(screen.getByTestId("terminal-key-strip")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("key-esc"));
    await waitFor(() => expect(ptySendMock).toHaveBeenCalledTimes(1));
    expect(ptySendMock.mock.calls[0][0]).toBe(1);
    expect(Array.from(ptySendMock.mock.calls[0][1] as Uint8Array)).toEqual([27]);

    fireEvent.click(screen.getByTestId("key-up"));
    await waitFor(() => expect(ptySendMock).toHaveBeenCalledTimes(2));
    expect(Array.from(ptySendMock.mock.calls[1][1] as Uint8Array)).toEqual([27, 91, 65]);
  });

  it("Ctrl mode sends a control byte to the terminal", async () => {
    await openTerminalTab();

    fireEvent.click(screen.getByTestId("key-ctrl"));
    fireEvent.click(screen.getByTestId("key-ctrl-c"));
    await waitFor(() => expect(ptySendMock).toHaveBeenCalledTimes(1));
    expect(Array.from(ptySendMock.mock.calls[0][1] as Uint8Array)).toEqual([3]);
  });

  it("double-tapping the terminal toggles the font size", async () => {
    await openTerminalTab();
    const container = screen.getByTestId("terminal-container");
    // Make the container measurable so the refit runs.
    Object.defineProperty(container, "offsetWidth", { value: 640, configurable: true });
    Object.defineProperty(container, "offsetHeight", { value: 400, configurable: true });

    const instance = terminalInstances[terminalInstances.length - 1];
    expect(instance.options.fontSize).toBe(13);

    fireEvent.dblClick(container);
    expect(instance.options.fontSize).toBe(16);

    fireEvent.dblClick(container);
    expect(instance.options.fontSize).toBe(13);
  });
});
