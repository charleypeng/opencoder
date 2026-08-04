// L2 tests for the terminal instance (TASK-M6-02): xterm mounts into the
// container with the fit addon, keystrokes are UTF-8 encoded and sent over
// the PTY WebSocket channel, incoming frames are decoded into the terminal,
// size changes sync through PUT /pty/{id} (the REST resize channel), the
// container is refit on resize (and never while hidden), a channel close
// marks the pty exited in the store, an exited pty renders the note (and
// never opens a channel), and unmounting closes the channel and disposes
// the terminal. xterm and the WS facade are mocked so no real DOM
// rendering or Tauri invoke happens.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { PtyWsOptions } from "../../services/ptyWs";
import { getServerPtyState, resetServer, upsertPty } from "../../stores/ptys";
import type { Pty } from "../../services/pty";
import TerminalInstance from "./TerminalInstance";

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
    options: Record<string, unknown>;
    onDataHandler?: (data: string) => void;
    onResizeHandler?: (size: { cols: number; rows: number }) => void;
    written: string[];
    open: ReturnType<typeof vi.fn>;
    loadAddon: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  }[] = [];
  const fitInstances: { fit: ReturnType<typeof vi.fn> }[] = [];
  class TerminalMock {
    options: Record<string, unknown> = {};
    onDataHandler?: (data: string) => void;
    onResizeHandler?: (size: { cols: number; rows: number }) => void;
    written: string[] = [];
    open = vi.fn();
    loadAddon = vi.fn();
    dispose = vi.fn();
    onData = vi.fn((handler: (data: string) => void) => {
      this.onDataHandler = handler;
      return { dispose: vi.fn() };
    });
    onResize = vi.fn((handler: (size: { cols: number; rows: number }) => void) => {
      this.onResizeHandler = handler;
      return { dispose: vi.fn() };
    });
    write = vi.fn((data: string) => {
      this.written.push(data);
    });
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

const SERVER = "srv-term";

function ptyFixture(overrides: Partial<Pty> = {}): Pty {
  return {
    id: "pty_1",
    title: "sh",
    command: "sh",
    args: [],
    cwd: "/mock/projects/opencode-demo",
    status: "running",
    pid: 1000,
    ...overrides,
  } as Pty;
}

/** A client whose PUT is a controllable spy (the only method the resize
 *  path uses). */
function mockClient() {
  const client = {
    put: vi.fn(async () => ptyFixture()),
    get: vi.fn(async () => []),
    post: vi.fn(async () => ptyFixture()),
    delete: vi.fn(async () => true),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

/** A ptyConnect stub returning a controllable connection; captures the
 *  options the component passes (onData/onClose). */
function connectFixture() {
  const close = vi.fn(async () => {});
  let options: PtyWsOptions | undefined;
  ptyConnectMock.mockImplementation(
    async (_serverId: string, _ptyId: string, opts: PtyWsOptions) => {
      options = opts;
      return { connectionId: 7, close };
    },
  );
  return {
    close,
    options: (): PtyWsOptions => {
      if (!options) throw new Error("ptyConnect was not called");
      return options;
    },
  };
}

function term() {
  const instance = terminalInstances[terminalInstances.length - 1];
  if (!instance) throw new Error("Terminal was not constructed");
  return instance;
}

function fit() {
  const instance = fitInstances[fitInstances.length - 1];
  if (!instance) throw new Error("FitAddon was not constructed");
  return instance;
}

/** Makes the container measurable so the visibility guard lets fit run. */
function makeVisible(width = 640, height = 400): void {
  const container = screen.getByTestId("terminal-container");
  Object.defineProperty(container, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(container, "offsetHeight", { value: height, configurable: true });
}

let resizeCallback: ResizeObserverCallback | undefined;
class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
}

beforeEach(() => {
  resizeCallback = undefined;
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.clearAllMocks();
  terminalInstances.length = 0;
  fitInstances.length = 0;
  getApiClientMock.mockReturnValue(mockClient());
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetServer(SERVER);
  vi.clearAllMocks();
});

describe("TerminalInstance", () => {
  it("mounts xterm into the container with the fit addon and a dark theme", async () => {
    connectFixture();
    render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status="running" onClose={vi.fn()} />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());

    const instance = term();
    expect(screen.getByTestId("terminal-container")).toBeInTheDocument();
    expect(instance.open).toHaveBeenCalledWith(screen.getByTestId("terminal-container"));
    expect(instance.loadAddon).toHaveBeenCalledTimes(1);
    expect(instance.options.fontSize).toBe(13);
    expect((instance.options.theme as { background?: string }).background).toBe("#0f1115");
  });

  it("opens the WebSocket channel for the pty with data and close callbacks", async () => {
    connectFixture();
    render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status="running" onClose={vi.fn()} />
    ));
    await waitFor(() =>
      expect(ptyConnectMock).toHaveBeenCalledWith(
        SERVER,
        "pty_1",
        expect.objectContaining({ onData: expect.any(Function), onClose: expect.any(Function) }),
      ),
    );
  });

  it("sends keystrokes as UTF-8 bytes over the channel", async () => {
    connectFixture();
    render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status="running" onClose={vi.fn()} />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());

    term().onDataHandler?.("ls\n");
    await waitFor(() => expect(ptySendMock).toHaveBeenCalledTimes(1));
    expect(ptySendMock.mock.calls[0][0]).toBe(7);
    expect(Array.from(ptySendMock.mock.calls[0][1] as Uint8Array)).toEqual([108, 115, 10]);

    // Non-ASCII input encodes as multi-byte UTF-8.
    term().onDataHandler?.("é");
    await waitFor(() => expect(ptySendMock).toHaveBeenCalledTimes(2));
    expect(Array.from(ptySendMock.mock.calls[1][1] as Uint8Array)).toEqual([195, 169]);
  });

  it("decodes incoming frames and writes them into the terminal", async () => {
    const { options } = connectFixture();
    render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status="running" onClose={vi.fn()} />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());

    options().onData(new Uint8Array([104, 105, 10]).buffer);
    options().onData(new Uint8Array([195, 169, 33]).buffer);
    expect(term().written).toEqual(["hi\n", "é!"]);
  });

  it("streams a UTF-8 sequence split across frames without U+FFFD", async () => {
    const { options } = connectFixture();
    render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status="running" onClose={vi.fn()} />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());

    // "hi" + the first byte of "é" (0xC3) arrive alone in one frame, the
    // second byte (0xA9) with "!" in the next. A non-streaming decode would
    // emit U+FFFD for each half; stream-mode must buffer the trailing byte.
    options().onData(new Uint8Array([104, 105, 195]).buffer);
    options().onData(new Uint8Array([169, 33]).buffer);
    expect(term().written).toEqual(["hi", "é!"]);
  });

  it("syncs terminal size changes through PUT /pty/{id}", async () => {
    const client = mockClient();
    connectFixture();
    render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status="running" onClose={vi.fn()} />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());

    term().onResizeHandler?.({ cols: 80, rows: 24 });
    await waitFor(() => expect(client.put).toHaveBeenCalledTimes(1));
    expect(client.put).toHaveBeenCalledWith("/pty/pty_1", {
      body: { size: { rows: 24, cols: 80 } },
    });
  });

  it("refits the container on resize, but never while hidden", async () => {
    connectFixture();
    render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status="running" onClose={vi.fn()} />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());
    const before = fit().fit.mock.calls.length;

    // Hidden container (jsdom reports 0x0): resize events do nothing.
    resizeCallback?.([], {} as ResizeObserver);
    expect(fit().fit.mock.calls.length).toBe(before);

    // A measurable container refits.
    makeVisible();
    resizeCallback?.([], {} as ResizeObserver);
    expect(fit().fit.mock.calls.length).toBe(before + 1);
  });

  it("marks the pty exited when the channel closes and shows the note", async () => {
    upsertPty(SERVER, ptyFixture());
    const { options } = connectFixture();
    const [status, setStatus] = createSignal("running");
    render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status={status()} onClose={vi.fn()} />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());
    expect(screen.queryByTestId("terminal-exited")).not.toBeInTheDocument();

    options().onClose?.();
    await waitFor(() => expect(getServerPtyState(SERVER).ptys["pty_1"].status).toBe("exited"));
    setStatus("exited");
    expect(screen.getByTestId("terminal-exited")).toHaveTextContent("Process exited");
    expect(screen.getByTestId("terminal-exited-close")).toBeInTheDocument();
  });

  it("renders the note for an exited pty with the exit code and never connects", () => {
    const onClose = vi.fn();
    render(() => (
      <TerminalInstance
        serverId={SERVER}
        ptyId="pty_1"
        status="exited"
        exitCode={1}
        onClose={onClose}
      />
    ));
    expect(ptyConnectMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("terminal-exited")).toHaveTextContent("Process exited (code 1)");

    fireEvent.click(screen.getByTestId("terminal-exited-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("unmounting closes the channel and disposes the terminal", async () => {
    const { close } = connectFixture();
    const { unmount } = render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status="running" onClose={vi.fn()} />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());

    unmount();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(term().dispose).toHaveBeenCalledTimes(1);
  });

  it("ignores frames, keystrokes, and resizes after dispose", async () => {
    const client = mockClient();
    const { options } = connectFixture();
    const { unmount } = render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status="running" onClose={vi.fn()} />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());

    unmount();
    await waitFor(() => expect(term().dispose).toHaveBeenCalledTimes(1));

    // A frame landing between the async connection.close() and the Rust-side
    // termination must not write into the disposed terminal.
    expect(() => {
      options().onData(new Uint8Array([104, 105, 10]).buffer);
    }).not.toThrow();
    expect(term().written).toHaveLength(0);

    term().onDataHandler?.("ls");
    expect(ptySendMock).not.toHaveBeenCalled();

    term().onResizeHandler?.({ cols: 80, rows: 24 });
    expect(client.put).not.toHaveBeenCalled();
  });
});

describe("TerminalInstance mobile input API and font zoom (TASK-M7-09)", () => {
  it("sendInput on a connected pty sends over the channel without local echo", async () => {
    connectFixture();
    let inputApi: { sendInput: (data: string) => void } | undefined;
    render(() => (
      <TerminalInstance
        serverId={SERVER}
        ptyId="pty_1"
        status="running"
        mobile
        onClose={vi.fn()}
        onApi={(api) => {
          inputApi = api;
        }}
      />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());
    expect(inputApi).toBeDefined();
    inputApi?.sendInput("ls\n");

    // No local write: the channel is echo-based (the server echoes
    // keystrokes back as frames), so a visible character would render
    // twice. Only the UTF-8 bytes go over the channel.
    expect(term().written).toEqual([]);
    await waitFor(() => expect(ptySendMock).toHaveBeenCalledTimes(1));
    expect(ptySendMock.mock.calls[0][0]).toBe(7);
    expect(Array.from(ptySendMock.mock.calls[0][1] as Uint8Array)).toEqual([108, 115, 10]);
  });

  it("sendInput on an exited pty writes locally without opening a channel", () => {
    let api: { sendInput: (data: string) => void } | undefined;
    render(() => (
      <TerminalInstance
        serverId={SERVER}
        ptyId="pty_1"
        status="exited"
        onClose={vi.fn()}
        onApi={(inputApi) => {
          api = inputApi;
        }}
      />
    ));
    expect(api).toBeDefined();
    expect(ptyConnectMock).not.toHaveBeenCalled();

    api?.sendInput("x");
    expect(term().written).toEqual(["x"]);
    expect(ptySendMock).not.toHaveBeenCalled();
  });

  it("sendInput is a no-op after dispose", async () => {
    connectFixture();
    let api: { sendInput: (data: string) => void } | undefined;
    const { unmount } = render(() => (
      <TerminalInstance
        serverId={SERVER}
        ptyId="pty_1"
        status="running"
        onClose={vi.fn()}
        onApi={(inputApi) => {
          api = inputApi;
        }}
      />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(term().dispose).toHaveBeenCalledTimes(1));

    api?.sendInput("x");
    expect(term().written).toHaveLength(0);
    expect(ptySendMock).not.toHaveBeenCalled();
  });

  it("mobile double-tap toggles the font size 13 <-> 16 and refits", async () => {
    connectFixture();
    render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status="running" mobile onClose={vi.fn()} />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());
    makeVisible();
    expect(term().options.fontSize).toBe(13);

    const container = screen.getByTestId("terminal-container");
    fireEvent.dblClick(container);
    expect(term().options.fontSize).toBe(16);
    const fitsAfterFirst = fit().fit.mock.calls.length;
    expect(fitsAfterFirst).toBeGreaterThan(0);

    fireEvent.dblClick(container);
    expect(term().options.fontSize).toBe(13);
  });

  it("desktop instances ignore double-taps", async () => {
    connectFixture();
    render(() => (
      <TerminalInstance serverId={SERVER} ptyId="pty_1" status="running" onClose={vi.fn()} />
    ));
    await waitFor(() => expect(ptyConnectMock).toHaveBeenCalled());

    fireEvent.dblClick(screen.getByTestId("terminal-container"));
    expect(term().options.fontSize).toBe(13);
  });
});
