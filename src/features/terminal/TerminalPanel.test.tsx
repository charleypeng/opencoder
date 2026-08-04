// L2 tests for the terminal panel (TASK-M6-02): tabs mirror the per-server
// ptys store (empty state when none), the + shell picker lists GET
// /pty/shells and creating a terminal POSTs /pty, adds the tab and opens
// its channel, tab switching activates another instance while all stay
// mounted (a PTY dies with its WebSocket, so hidden tabs are never
// unmounted), the tab close button removes the pty (the instance unmount
// closes its channel) and DELETEs the server-side pty, and an exited tab
// keeps its note until closed. xterm and the WS facade are mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import type { PtyWsOptions } from "../../services/ptyWs";
import { getServerPtyState, resetServer, upsertPty } from "../../stores/ptys";
import type { Pty, PtyShell } from "../../services/pty";
import TerminalPanel from "./TerminalPanel";

const {
  getApiClientMock,
  ptyConnectMock,
  ptySendMock,
  TerminalMock,
  FitAddonMock,
  terminalInstances,
  fitInstances,
} = vi.hoisted(() => {
  const getApiClientMock = vi.fn();
  const terminalInstances: {
    open: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }[] = [];
  const fitInstances: { fit: ReturnType<typeof vi.fn> }[] = [];
  class TerminalMock {
    options: Record<string, unknown> = {};
    open = vi.fn();
    loadAddon = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    write = vi.fn();
    constructor() {
      terminalInstances.push(this);
    }
  }
  class FitAddonMock {
    fit = vi.fn();
    activate = vi.fn();
    proposeDimensions = vi.fn();
    dispose = vi.fn();
    constructor() {
      fitInstances.push(this);
    }
  }
  return {
    getApiClientMock,
    ptyConnectMock: vi.fn(),
    ptySendMock: vi.fn(),
    TerminalMock,
    FitAddonMock,
    terminalInstances,
    fitInstances,
  };
});

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));
vi.mock("../../services/ptyWs.js", () => ({
  ptyConnect: ptyConnectMock,
  ptySend: ptySendMock,
}));
vi.mock("@xterm/xterm", () => ({ Terminal: TerminalMock }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: FitAddonMock }));

const SERVER = "srv-panel";

function pty(id: string, overrides: Partial<Pty> = {}): Pty {
  return {
    id,
    title: `terminal ${id}`,
    command: "sh",
    args: [],
    cwd: "/mock/projects/opencode-demo",
    status: "running",
    pid: 1000,
    ...overrides,
  } as Pty;
}

const SHELLS: PtyShell[] = [
  { path: "/bin/zsh", name: "zsh", acceptable: true },
  { path: "/bin/bash", name: "bash", acceptable: true },
  { path: "/usr/bin/fish", name: "fish", acceptable: false },
];

/** A client whose get/post/delete are controllable spies. */
function mockClient() {
  const client = {
    get: vi.fn(async () => SHELLS),
    post: vi.fn(async () => pty("pty_created_1")),
    put: vi.fn(async () => pty("pty_created_1")),
    delete: vi.fn(async () => true),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

/** A ptyConnect stub; every call resolves a connection keyed by pty id. */
function connectFixture() {
  const connections: {
    [ptyId: string]: { connectionId: number; close: ReturnType<typeof vi.fn> };
  } = {};
  let sequence = 0;
  ptyConnectMock.mockImplementation(async (_serverId: string, ptyId: string) => {
    sequence += 1;
    const connection = {
      connectionId: sequence,
      close: vi.fn(async () => {}),
    };
    connections[ptyId] = connection;
    return connection;
  });
  return {
    connections,
    of: (ptyId: string) => {
      const connection = connections[ptyId];
      if (!connection) throw new Error(`no connection for ${ptyId}`);
      return connection;
    },
    calls: () => ptyConnectMock.mock.calls as [string, string, PtyWsOptions][],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  terminalInstances.length = 0;
  fitInstances.length = 0;
  getApiClientMock.mockReturnValue(mockClient());
});

afterEach(() => {
  resetServer(SERVER);
  vi.clearAllMocks();
});

describe("TerminalPanel tabs", () => {
  it("shows the empty state without terminals and renders tabs from the store", async () => {
    connectFixture();
    render(() => <TerminalPanel serverId={SERVER} />);

    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-tab-pty_1")).not.toBeInTheDocument();

    // A pty.created event (or another client) fills the store live.
    upsertPty(SERVER, pty("pty_1"));
    await waitFor(() => expect(screen.getByTestId("terminal-tab-pty_1")).toBeInTheDocument());
    expect(screen.queryByTestId("terminal-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("terminal-tab-pty_1")).toHaveTextContent("terminal pty_1");
    expect(screen.getByTestId("terminal-tab-pty_1")).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(ptyConnectMock).toHaveBeenCalledWith(SERVER, "pty_1", expect.any(Object)),
    );
  });

  it("the + button opens the shell picker; picking a shell creates and activates a tab", async () => {
    const client = mockClient();
    connectFixture();
    render(() => <TerminalPanel serverId={SERVER} />);

    fireEvent.click(screen.getByTestId("terminal-new"));
    const picker = await waitFor(() => screen.getByTestId("terminal-shell-picker"));
    await waitFor(() => expect(client.get).toHaveBeenCalledWith("/pty/shells", undefined));
    expect(within(picker).getByTestId("terminal-shell-default")).toBeInTheDocument();
    expect(within(picker).getByTestId("terminal-shell-zsh")).toBeInTheDocument();
    expect(within(picker).getByTestId("terminal-shell-fish")).toHaveTextContent(
      "fish (unsupported)",
    );

    fireEvent.click(within(picker).getByTestId("terminal-shell-zsh"));
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
    expect(client.post).toHaveBeenCalledWith("/pty", {
      body: { command: "/bin/zsh", title: "zsh" },
    });

    await waitFor(() =>
      expect(screen.getByTestId("terminal-tab-pty_created_1")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("terminal-tab-pty_created_1")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByTestId("terminal-shell-picker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("terminal-empty")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(ptyConnectMock).toHaveBeenCalledWith(SERVER, "pty_created_1", expect.any(Object)),
    );
  });

  it("the default shell row creates without a command and retries a failed shell list", async () => {
    const client = mockClient();
    client.get.mockRejectedValueOnce(new Error("down"));
    connectFixture();
    render(() => <TerminalPanel serverId={SERVER} />);

    fireEvent.click(screen.getByTestId("terminal-new"));
    await waitFor(() => expect(screen.getByTestId("terminal-shells-error")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("terminal-shells-retry"));
    await waitFor(() => expect(screen.getByTestId("terminal-shell-zsh")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("terminal-shell-default"));
    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
    expect(client.post).toHaveBeenCalledWith("/pty", { body: {} });
  });

  it("switching tabs activates the other instance while all stay mounted", async () => {
    connectFixture();
    upsertPty(SERVER, pty("pty_1"));
    upsertPty(SERVER, pty("pty_2"));
    render(() => <TerminalPanel serverId={SERVER} />);

    await waitFor(() =>
      expect(screen.getByTestId("terminal-instance-pty_1")).toHaveAttribute("data-active", "true"),
    );
    expect(screen.getByTestId("terminal-instance-pty_2")).toHaveAttribute("data-active", "false");

    fireEvent.click(screen.getByTestId("terminal-tab-pty_2"));
    expect(screen.getByTestId("terminal-tab-pty_1")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("terminal-tab-pty_2")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("terminal-instance-pty_1")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("terminal-instance-pty_2")).toHaveAttribute("data-active", "true");
    // Both instances stayed mounted (hidden, not unmounted).
    expect(terminalInstances).toHaveLength(2);
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalledTimes(2));
  });

  it("the tab close button removes the pty and closes its channel", async () => {
    const client = mockClient();
    const { of } = connectFixture();
    upsertPty(SERVER, pty("pty_1"));
    upsertPty(SERVER, pty("pty_2"));
    render(() => <TerminalPanel serverId={SERVER} />);
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalledTimes(2));
    // Let the connect promises' .then callbacks (connection assignment) land.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const closing = of("pty_1");

    fireEvent.click(screen.getByTestId("terminal-tab-close-pty_1"));
    await waitFor(() => expect(getServerPtyState(SERVER).ptys["pty_1"]).toBeUndefined());
    expect(screen.queryByTestId("terminal-tab-pty_1")).not.toBeInTheDocument();
    // The instance unmount closed its channel.
    await waitFor(() => expect(closing.close).toHaveBeenCalledTimes(1));
    // The server-side pty is DELETEd (kills the process).
    await waitFor(() => expect(client.delete).toHaveBeenCalledWith("/pty/pty_1", undefined));
    // The remaining tab becomes active.
    expect(screen.getByTestId("terminal-tab-pty_2")).toHaveAttribute("aria-selected", "true");
  });

  it("an exited tab keeps its note until closed", async () => {
    connectFixture();
    upsertPty(SERVER, pty("pty_1"));
    upsertPty(SERVER, pty("pty_2", { status: "exited", exitCode: 1 }));
    render(() => <TerminalPanel serverId={SERVER} />);

    await waitFor(() => expect(screen.getByTestId("terminal-exited")).toBeInTheDocument());
    expect(screen.getByTestId("terminal-exited")).toHaveTextContent("Process exited (code 1)");
    // Exited ptys never open a channel.
    expect(ptyConnectMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("terminal-exited-close"));
    await waitFor(() => expect(getServerPtyState(SERVER).ptys["pty_2"]).toBeUndefined());
    expect(screen.queryByTestId("terminal-tab-pty_2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("terminal-exited")).not.toBeInTheDocument();
  });

  it("shows an inline error when creating fails and keeps the picker open", async () => {
    const client = mockClient();
    client.post.mockRejectedValueOnce(new Error("down"));
    connectFixture();
    render(() => <TerminalPanel serverId={SERVER} />);

    fireEvent.click(screen.getByTestId("terminal-new"));
    await waitFor(() => screen.getByTestId("terminal-shell-zsh"));
    fireEvent.click(screen.getByTestId("terminal-shell-zsh"));

    await waitFor(() => expect(screen.getByTestId("terminal-create-error")).toBeInTheDocument());
    expect(screen.getByTestId("terminal-shell-picker")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-empty")).toBeInTheDocument();
  });
});

describe("TerminalPanel mobile variant (TASK-M7-09)", () => {
  it("renders the key strip wired to the ACTIVE instance's channel", async () => {
    connectFixture();
    upsertPty(SERVER, pty("pty_1"));
    upsertPty(SERVER, pty("pty_2"));
    render(() => <TerminalPanel serverId={SERVER} variant="mobile" />);
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalledTimes(2));
    // Let the connect promises' .then callbacks (connection assignment) land.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByTestId("terminal-key-strip")).toBeInTheDocument();
    expect(terminalInstances).toHaveLength(2);

    // Esc routes into the active tab's instance (pty_1, connectionId 1).
    fireEvent.click(screen.getByTestId("key-esc"));
    await waitFor(() => expect(ptySendMock).toHaveBeenCalledTimes(1));
    expect(ptySendMock.mock.calls[0][0]).toBe(1);
    expect(Array.from(ptySendMock.mock.calls[0][1] as Uint8Array)).toEqual([27]);

    // Switching the active tab reroutes the strip (pty_2, connectionId 2).
    fireEvent.click(screen.getByTestId("terminal-tab-pty_2"));
    fireEvent.click(screen.getByTestId("key-pipe"));
    await waitFor(() => expect(ptySendMock).toHaveBeenCalledTimes(2));
    expect(ptySendMock.mock.calls[1][0]).toBe(2);
    expect(Array.from(ptySendMock.mock.calls[1][1] as Uint8Array)).toEqual([124]);
  });

  it("never renders the strip on desktop", async () => {
    connectFixture();
    upsertPty(SERVER, pty("pty_1"));
    render(() => <TerminalPanel serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("terminal-tab-pty_1")).toBeInTheDocument());
    expect(screen.queryByTestId("terminal-key-strip")).not.toBeInTheDocument();
  });
});
