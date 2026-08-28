// L2 tests for the command palette (TASK-M8-02): opens with the search
// input focused and the action overview (sessions/commands/settings/
// servers — files/symbols stay hidden until a query), the command catalog
// is fetched once per instance and cached across reopens, typing filters
// the local sources synchronously and debounces 150ms before fetching
// /find/file (rapid keystrokes collapse into one request, stale in-flight
// responses are dropped, a failed search shows the empty state), a
// `#`-prefixed query switches to /find/symbol with the stripped term,
// ↑↓ wrap across section boundaries, Enter/click execute the right action
// per kind through the mocked actions (sessions/commands/settings/
// servers via callbacks; files/symbols with the QuickOpen side effects —
// viewer tab + active line + recent memory — before onOpenFile/
// onOpenSymbol), Esc closes without executing, reopening resets the query
// and cancels a pending debounce, and without an active session the
// Commands section and the diff action are gated off.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { resetServer as resetProject, setCurrent } from "../../stores/project";
import { setActiveServer } from "../../stores/registry";
import { applySessionList, resetServer as resetSessions } from "../../stores/session";
import { resetServer as resetViewer, viewer } from "../../stores/viewer";
import { readRecentFiles } from "../../features/files/recentFiles";
import type { Session } from "../../services/session";
import type { ServerEntry } from "../../services/servers";
import CommandPalette, { type CommandPaletteActions } from "./CommandPalette";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-palette";
const DEBOUNCE_MS = 150;
const DIRECTORY = "/mock/projects/opencode-demo";

const COMMANDS = [
  { name: "init", description: "Initialize the project", template: "", hints: [] },
  { name: "think", description: "Think deeply about a topic", template: "", hints: [] },
];

const SERVERS: ServerEntry[] = [
  { id: "srv-alpha", name: "Alpha", url: "http://alpha.local:14096", createdAt: 1 },
  { id: "srv-beta", name: "Beta", url: "http://beta.local:14096", createdAt: 2 },
];

/** /find/symbol fixture rows in the LSP Symbol shape (0-based positions). */
const SYMBOL_ROWS = [
  {
    name: "PromptBox",
    kind: 12,
    location: {
      uri: "file:///mock/projects/opencode-demo/src/features/sessions/PromptBox.tsx",
      range: { start: { line: 68, character: 15 }, end: { line: 68, character: 24 } },
    },
  },
  {
    name: "buildTree",
    kind: 6,
    location: {
      uri: "file:///mock/projects/opencode-demo/src/features/files/FileTree.tsx",
      range: { start: { line: 91, character: 10 }, end: { line: 91, character: 19 } },
    },
  },
];

function session(id: string, title: string, updated: number): Session {
  return {
    id,
    slug: id,
    title,
    projectID: "project-mock-1",
    directory: DIRECTORY,
    version: "1.18.11",
    time: { created: 1, updated },
  } as Session;
}

/** A client whose `get` is a controllable mock resolving to path arrays. */
function mockClient() {
  const client = {
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => []),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

/** The shell actions, every one a no-op spy. */
function actions(): CommandPaletteActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onNewSession: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleSidebar: vi.fn(),
    onOpenTerminal: vi.fn(),
    onOpenDiff: vi.fn(),
    onSwitchServer: vi.fn(),
    onOpenSession: vi.fn(),
    onRunCommand: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenSymbol: vi.fn(),
  };
}

function input(): HTMLInputElement {
  return screen.getByTestId("command-palette-input") as HTMLInputElement;
}

function rows(): HTMLElement[] {
  return screen.getAllByRole("option");
}

function sectionIds(): string[] {
  return Array.from(document.querySelectorAll('[data-testid^="command-palette-section-"]')).map(
    (el) => el.getAttribute("data-testid") ?? "",
  );
}

/** The commands fetch resolves with the fixture (microtask flush). */
async function flushCommandsFetch(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetSessions(SERVER);
  resetViewer(SERVER);
  resetProject(SERVER);
  setActiveServer(SERVER);
  setCurrent(SERVER, DIRECTORY);
  getApiClientMock.mockReset();
  mockClient();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  resetSessions(SERVER);
  resetViewer(SERVER);
  resetProject(SERVER);
  setActiveServer(null);
});

describe("CommandPalette open/close lifecycle", () => {
  it("is inert while closed", () => {
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open={false}
        hasActiveSession
        actions={actions()}
        onClose={vi.fn()}
      />
    ));
    expect(screen.queryByTestId("command-palette-dialog")).not.toBeInTheDocument();
  });

  it("opens with the input focused and the action overview", async () => {
    const client = mockClient();
    client.get.mockImplementation(async (path: string) => {
      if (path === "/command") return COMMANDS;
      return [];
    });
    applySessionList(SERVER, [session("sess_b", "Build the app", 2)]);
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={actions()}
        onClose={vi.fn()}
      />
    ));
    await flushCommandsFetch();

    expect(screen.getByTestId("command-palette-dialog")).toBeInTheDocument();
    expect(input()).toHaveFocus();
    // Fixed order: sessions, commands, settings, servers; the remote
    // sections stay hidden until a query is typed.
    expect(sectionIds()).toEqual([
      "command-palette-section-sessions",
      "command-palette-section-commands",
      "command-palette-section-settings",
      "command-palette-section-servers",
    ]);
    expect(screen.queryByTestId("command-palette-section-files")).not.toBeInTheDocument();
    expect(screen.queryByTestId("command-palette-section-symbols")).not.toBeInTheDocument();
    // Keyboard-first footer: the hint row renders below the list.
    expect(screen.getByTestId("command-palette-footer")).toBeInTheDocument();
    expect(screen.getByTestId("command-palette-footer")).toHaveTextContent("↑↓ Navigate");
  });

  it("reopening resets the query and cancels a pending debounce", async () => {
    const client = mockClient();
    const [open, setOpen] = createSignal(false);
    const onClose = vi.fn();
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open={open()}
        hasActiveSession
        actions={actions()}
        onClose={onClose}
      />
    ));

    setOpen(true);
    fireEvent.input(input(), { target: { value: "rea" } });
    setOpen(false);
    setOpen(true);

    expect(input().value).toBe("");
    // Back to the overview: the empty state is gone and the local
    // sections are listed again.
    expect(screen.queryByTestId("command-palette-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("command-palette-section-settings")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(client.get).not.toHaveBeenCalledWith("/find/file", expect.anything());
  });

  it("Esc closes through the dialog without executing", () => {
    const onClose = vi.fn();
    const act = actions();
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={act}
        onClose={onClose}
      />
    ));

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    for (const key of Object.keys(act)) expect(act[key]).not.toHaveBeenCalled();
  });

  it("fetches the command catalog once and caches it across reopens", async () => {
    const client = mockClient();
    client.get.mockImplementation(async (path: string) => {
      if (path === "/command") return COMMANDS;
      return [];
    });
    const [open, setOpen] = createSignal(true);
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open={open()}
        hasActiveSession
        actions={actions()}
        onClose={vi.fn()}
      />
    ));
    await flushCommandsFetch();
    expect(client.get).toHaveBeenCalledWith("/command", undefined);
    expect(screen.getByTestId("command-palette-section-commands")).toBeInTheDocument();

    setOpen(false);
    setOpen(true);
    await flushCommandsFetch();
    expect(client.get.mock.calls.filter(([path]) => path === "/command")).toHaveLength(1);
    expect(screen.getByTestId("command-palette-section-commands")).toBeInTheDocument();
  });
});

describe("CommandPalette local sources", () => {
  async function renderOverview(client: ReturnType<typeof mockClient>) {
    client.get.mockImplementation(async (path: string) => {
      if (path === "/command") return COMMANDS;
      return [];
    });
    applySessionList(SERVER, [
      session("sess_a", "Fix the bug", 1),
      session("sess_b", "Build the app", 2),
    ]);
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={actions()}
        onClose={vi.fn()}
      />
    ));
    await flushCommandsFetch();
  }

  it("filters sessions, commands, settings and servers synchronously while typing", async () => {
    const client = mockClient();
    await renderOverview(client);

    fireEvent.input(input(), { target: { value: "beta" } });
    expect(sectionIds()).toEqual(["command-palette-section-servers"]);
    expect(screen.getByTestId("command-palette-item-server-srv-beta")).toBeInTheDocument();
    // The files fetch is still inside the debounce window.
    expect(client.get).not.toHaveBeenCalledWith("/find/file", expect.anything());

    fireEvent.input(input(), { target: { value: "think" } });
    expect(sectionIds()).toEqual(["command-palette-section-commands"]);
    expect(screen.getByTestId("command-palette-item-command-think")).toBeInTheDocument();

    fireEvent.input(input(), { target: { value: "" } });
    expect(sectionIds()).toEqual([
      "command-palette-section-sessions",
      "command-palette-section-commands",
      "command-palette-section-settings",
      "command-palette-section-servers",
    ]);
  });

  it("sessions list in store order (most recent first)", async () => {
    const client = mockClient();
    await renderOverview(client);
    expect(screen.getByTestId("command-palette-section-sessions")).toBeInTheDocument();
    const sessionRows = Array.from(
      document.querySelectorAll('[data-testid^="command-palette-item-session-"]'),
    );
    expect(sessionRows.map((row) => row.textContent)).toEqual(["Build the app", "Fix the bug"]);
  });

  it("gates the Commands section and the diff action without an active session", async () => {
    const client = mockClient();
    applySessionList(SERVER, [session("sess_a", "Fix the bug", 1)]);
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession={false}
        actions={actions()}
        onClose={vi.fn()}
      />
    ));
    await flushCommandsFetch();

    expect(client.get).not.toHaveBeenCalledWith("/command", expect.anything());
    expect(screen.queryByTestId("command-palette-section-commands")).not.toBeInTheDocument();
    expect(screen.queryByTestId("command-palette-item-setting-open-diff")).not.toBeInTheDocument();
    expect(sectionIds()).toEqual([
      "command-palette-section-sessions",
      "command-palette-section-settings",
      "command-palette-section-servers",
    ]);
  });
});

describe("CommandPalette remote search", () => {
  it("debounces typing by 150ms then fetches /find/file and renders ranked rows", async () => {
    const client = mockClient();
    client.get.mockImplementation(async (path: string) => {
      if (path === "/find/file") return ["src/readme.md", "README.txt", "src/app.ts"];
      return [];
    });
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={actions()}
        onClose={vi.fn()}
      />
    ));

    fireEvent.input(input(), { target: { value: "rea" } });
    expect(client.get).not.toHaveBeenCalledWith("/find/file", expect.anything());

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(client.get).not.toHaveBeenCalledWith("/find/file", expect.anything());
    await vi.advanceTimersByTimeAsync(1);
    // One more tick lets the fetch's promise chain land in the DOM.
    await vi.advanceTimersByTimeAsync(0);

    expect(client.get).toHaveBeenCalledWith("/find/file", { query: { query: "rea" } });
    expect(screen.getByTestId("command-palette-section-files")).toBeInTheDocument();
    // Ranked display: prefix matches first, then substring, then fuzzy.
    expect(rows().map((row) => row.textContent)).toEqual([
      "README.txt",
      "src/readme.md",
      "src/app.ts",
    ]);
  });

  it("collapses rapid keystrokes into a single fetch", async () => {
    const client = mockClient();
    client.get.mockImplementation(async (path: string) => {
      if (path === "/find/file") return ["a.ts"];
      return [];
    });
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={actions()}
        onClose={vi.fn()}
      />
    ));

    fireEvent.input(input(), { target: { value: "a" } });
    fireEvent.input(input(), { target: { value: "ab" } });
    fireEvent.input(input(), { target: { value: "abc" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(client.get.mock.calls.filter(([path]) => path === "/find/file")).toHaveLength(1);
    expect(client.get).toHaveBeenCalledWith("/find/file", { query: { query: "abc" } });
  });

  it("drops a stale in-flight response", async () => {
    const client = mockClient();
    const pending: Array<(value: string[]) => void> = [];
    client.get.mockImplementation((path: string) => {
      if (path !== "/find/file") return Promise.resolve([]);
      return new Promise<string[]>((resolve) => pending.push(resolve));
    });
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={actions()}
        onClose={vi.fn()}
      />
    ));

    fireEvent.input(input(), { target: { value: "a" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pending).toHaveLength(1);

    fireEvent.input(input(), { target: { value: "ab" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(pending).toHaveLength(2);

    // The newer query resolves first, then the stale one comes back late.
    pending[1](["src/new.ts"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(rows().map((row) => row.textContent)).toEqual(["src/new.ts"]);

    pending[0](["zzz-stale.ts"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(rows().map((row) => row.textContent)).toEqual(["src/new.ts"]);
  });

  it("shows a loading row while the first fetch is in flight", async () => {
    const client = mockClient();
    client.get.mockImplementation(() => new Promise(() => {}));
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={actions()}
        onClose={vi.fn()}
      />
    ));

    fireEvent.input(input(), { target: { value: "rea" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(screen.getByTestId("command-palette-loading")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([]);
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={actions()}
        onClose={vi.fn()}
      />
    ));

    fireEvent.input(input(), { target: { value: "zzz" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    // One more tick lets the fetch's promise chain land in the DOM.
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
  });

  it("shows the empty state when the search fails", async () => {
    const client = mockClient();
    client.get.mockRejectedValue(new Error("boom"));
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={actions()}
        onClose={vi.fn()}
      />
    ));

    fireEvent.input(input(), { target: { value: "rea" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
  });

  it("searches symbols instead of files for a #-prefixed query", async () => {
    const client = mockClient();
    client.get.mockImplementation(async (path: string) => {
      if (path === "/find/symbol") return SYMBOL_ROWS;
      return [];
    });
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={actions()}
        onClose={vi.fn()}
      />
    ));

    fireEvent.input(input(), { target: { value: "#Pro" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    // One more tick lets the fetch's promise chain land in the DOM.
    await vi.advanceTimersByTimeAsync(0);

    expect(client.get).toHaveBeenCalledWith("/find/symbol", { query: { query: "Pro" } });
    expect(screen.getByTestId("command-palette-section-symbols")).toBeInTheDocument();
    expect(screen.queryByTestId("command-palette-section-files")).not.toBeInTheDocument();
    const row = screen.getByTestId(
      "command-palette-item-symbol-PromptBox:src/features/sessions/PromptBox.tsx:69",
    );
    expect(row.textContent).toContain("ƒ");
    expect(row.textContent).toContain("PromptBox");
    expect(row.textContent).toContain("src/features/sessions/PromptBox.tsx");
  });
});

describe("CommandPalette keyboard navigation and execution", () => {
  function selectedKey(): string {
    const active = rows().find((row) => row.getAttribute("aria-selected") === "true");
    return active?.getAttribute("data-testid") ?? "";
  }

  async function renderWithLocalResults(
    act: CommandPaletteActions & Record<string, ReturnType<typeof vi.fn>>,
  ) {
    const client = mockClient();
    client.get.mockImplementation(async (path: string) => {
      if (path === "/command") return [COMMANDS[0]];
      return [];
    });
    applySessionList(SERVER, [
      session("sess_fix", "Fix the bug", 1),
      session("sess_build", "Build the app", 2),
    ]);
    const onClose = vi.fn();
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={act}
        onClose={onClose}
      />
    ));
    await flushCommandsFetch();
    return { onClose, client };
  }

  it("↑↓ wrap across section boundaries and Enter executes the selected row", async () => {
    const act = actions();
    const { onClose } = await renderWithLocalResults(act);

    // Overview rows: sessions (2), commands (1), settings (5), servers (2).
    expect(selectedKey()).toBe("command-palette-item-session-sess_build");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedKey()).toBe("command-palette-item-session-sess_fix");
    // Across the sessions → commands boundary.
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedKey()).toBe("command-palette-item-command-init");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedKey()).toBe("command-palette-item-setting-new-session");

    // ArrowUp from the first row wraps to the last row of the list.
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(selectedKey()).toBe("command-palette-item-command-init");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(selectedKey()).toBe("command-palette-item-session-sess_fix");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(selectedKey()).toBe("command-palette-item-session-sess_build");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(selectedKey()).toBe("command-palette-item-server-srv-beta");

    // And back down to the first row again.
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedKey()).toBe("command-palette-item-session-sess_build");

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(act.onRunCommand).toHaveBeenCalledWith("init");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter on a session row opens the session through the action", async () => {
    const act = actions();
    const { onClose } = await renderWithLocalResults(act);

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(act.onOpenSession).toHaveBeenCalledWith("sess_build");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter on a command row runs the command through the action", async () => {
    const act = actions();
    const { onClose } = await renderWithLocalResults(act);

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(act.onRunCommand).toHaveBeenCalledWith("init");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter on a setting row runs the mapped action", async () => {
    const act = actions();
    const { onClose } = await renderWithLocalResults(act);

    // Navigate to "Open settings" (sessions 2, command 1, then the row).
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedKey()).toBe("command-palette-item-setting-new-session");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(act.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter on a server row switches the server through the action", async () => {
    const act = actions();
    const { onClose } = await renderWithLocalResults(act);

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedKey()).toBe("command-palette-item-server-srv-alpha");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(act.onSwitchServer).toHaveBeenCalledWith("srv-alpha");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps from the clamped last row after the list shrinks mid-open", async () => {
    const act = actions();
    const { onClose } = await renderWithLocalResults(act);

    // Overview rows: sessions (2), commands (1), settings (5), servers (2).
    // ArrowDown to the last row → the raw selection sits at 9.
    for (let i = 0; i < 9; i += 1) fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedKey()).toBe("command-palette-item-server-srv-beta");

    // The session store shrinks while the palette is open (typing/search
    // reset the selection, a store change does not): the raw selection
    // still points past the now 9-row list, clamped to its last row.
    applySessionList(SERVER, [session("sess_fix", "Fix the bug", 1)]);

    // ArrowDown must wrap to the FIRST row of the clamped list; a modulo
    // over the raw index would land on row 1 instead ((9+1+9)%9 = 1).
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedKey()).toBe("command-palette-item-session-sess_fix");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Enter on a file row opens the file with the QuickOpen side effects", async () => {
    const act = actions();
    const client = mockClient();
    client.get.mockImplementation(async (path: string) => {
      if (path === "/find/file") return ["src/app.ts", "src/boot.ts"];
      return [];
    });
    applySessionList(SERVER, [session("sess_a", "Fix the bug", 1)]);
    const onClose = vi.fn();
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={act}
        onClose={onClose}
      />
    ));
    await flushCommandsFetch();

    fireEvent.input(input(), { target: { value: "src" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    // One more tick lets the fetch's promise chain land in the DOM.
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("command-palette-section-files")).toBeInTheDocument();

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(viewer[SERVER]?.tabs.map((tab) => tab.path)).toEqual(["src/boot.ts"]);
    expect(viewer[SERVER]?.activePath).toBe("src/boot.ts");
    expect(readRecentFiles(SERVER)).toEqual(["src/boot.ts"]);
    expect(act.onOpenFile).toHaveBeenCalledWith("src/boot.ts");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter on a symbol row jumps to the file and its 1-based line", async () => {
    const act = actions();
    const client = mockClient();
    client.get.mockImplementation(async (path: string) => {
      if (path === "/find/symbol") return SYMBOL_ROWS;
      return [];
    });
    const onClose = vi.fn();
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={act}
        onClose={onClose}
      />
    ));
    await flushCommandsFetch();

    fireEvent.input(input(), { target: { value: "#build" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(rows()).toHaveLength(2);

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });

    const path = "src/features/files/FileTree.tsx";
    expect(viewer[SERVER]?.tabs.map((tab) => tab.path)).toEqual([path]);
    expect(viewer[SERVER]?.activeLine).toEqual({ path, line: 92 });
    expect(act.onOpenSymbol).toHaveBeenCalledWith(path, 92);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a click executes the same action and closes", async () => {
    const act = actions();
    const { onClose } = await renderWithLocalResults(act);

    fireEvent.click(screen.getByTestId("command-palette-item-server-srv-beta"));
    expect(act.onSwitchServer).toHaveBeenCalledWith("srv-beta");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Enter with no results", async () => {
    const act = actions();
    const client = mockClient();
    client.get.mockResolvedValue([]);
    render(() => (
      <CommandPalette
        serverId={SERVER}
        servers={SERVERS}
        open
        hasActiveSession
        actions={act}
        onClose={vi.fn()}
      />
    ));

    fireEvent.input(input(), { target: { value: "zzz" } });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(act.onOpenSession).not.toHaveBeenCalled();
    expect(act.onRunCommand).not.toHaveBeenCalled();
    expect(act.onSwitchServer).not.toHaveBeenCalled();
  });
});
