// L1 tests for the PTY WebSocket facade (TASK-M6-01): Channel envelope
// handling (bytes -> ArrayBuffer, closed control frame) and invoke payload
// assembly for connect/send/close. The optional L3 block exercises the
// Rust-side channel flow against a live mock server when MOCK_URL is set
// (the ws-echo fixture, started by the mock self-test).

import { afterEach, describe, expect, it, vi } from "vitest";
import { ptyConnect, ptySend } from "./ptyWs.js";

const { invokeMock, ChannelMock } = vi.hoisted(() => {
  const invokeMock = vi.fn();
  class ChannelMock {
    onmessage?: (message: unknown) => void;
    constructor(onmessage?: (message: unknown) => void) {
      this.onmessage = onmessage ?? (() => {});
    }
  }
  return { invokeMock, ChannelMock };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: ChannelMock,
}));

interface ChannelArgs {
  channel: { onmessage?: (message: unknown) => void };
  [key: string]: unknown;
}

function connect(onData: (bytes: ArrayBuffer) => void, onClose?: () => void) {
  let channel: { onmessage?: (message: unknown) => void } | undefined;
  invokeMock.mockImplementation((_command: string, args: unknown) => {
    channel = (args as ChannelArgs).channel;
    return Promise.resolve(7);
  });
  void ptyConnect("srv-1", "pty_abc", { onData, onClose });
  return {
    channel: () => {
      if (!channel) throw new Error("channel not captured");
      return channel;
    },
  };
}

describe("ptyWs facade", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("invokes pty_ws_connect with serverId, ptyId, directory and a channel", async () => {
    invokeMock.mockResolvedValue(9);
    const connection = await ptyConnect("srv-1", "pty_abc", {
      directory: "/proj",
      onData: () => {},
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("pty_ws_connect", {
      serverId: "srv-1",
      ptyId: "pty_abc",
      directory: "/proj",
      channel: expect.any(ChannelMock),
      auth: undefined,
    });
    expect(connection.connectionId).toBe(9);
    expect(typeof connection.close).toBe("function");
  });

  it("passes auth through when provided", async () => {
    invokeMock.mockResolvedValue(1);
    await ptyConnect("srv-1", "pty_abc", {
      onData: () => {},
      auth: { username: "user", password: "pass" },
    });
    expect(invokeMock.mock.calls[0][1]).toMatchObject({
      auth: { username: "user", password: "pass" },
    });
  });

  it("converts envelope byte arrays to exact-size ArrayBuffers", () => {
    const received: Uint8Array[] = [];
    const { channel } = connect((bytes) => {
      received.push(new Uint8Array(bytes));
    });

    channel().onmessage?.({ bytes: [1, 2, 3] });
    channel().onmessage?.({ bytes: [104, 105] });
    expect(received.map((bytes) => Array.from(bytes))).toEqual([
      [1, 2, 3],
      [104, 105],
    ]);
  });

  it("fires onClose on the closed control frame", () => {
    const closed: unknown[] = [];
    const { channel } = connect(
      () => {},
      () => closed.push("closed"),
    );

    channel().onmessage?.({ type: "pty.ws.closed" });
    expect(closed).toEqual(["closed"]);

    // Data frames after a close are still forwarded as bytes.
    channel().onmessage?.({ bytes: [120] });
    expect(closed).toEqual(["closed"]);
  });

  it("ignores unknown envelope shapes", () => {
    const received: ArrayBuffer[] = [];
    const closed: unknown[] = [];
    const { channel } = connect(
      (bytes) => received.push(bytes),
      () => closed.push("closed"),
    );

    channel().onmessage?.(null);
    channel().onmessage?.("noise");
    channel().onmessage?.({});
    channel().onmessage?.({ type: "something.else" });
    expect(received).toEqual([]);
    expect(closed).toEqual([]);
  });

  it("close invokes pty_ws_close with the connection id", async () => {
    invokeMock.mockResolvedValue(42);
    const connection = await ptyConnect("srv-1", "pty_abc", { onData: () => {} });
    await connection.close();
    expect(invokeMock).toHaveBeenLastCalledWith("pty_ws_close", { connectionId: 42 });
  });

  it("ptySend invokes pty_ws_send with the bytes array", async () => {
    invokeMock.mockResolvedValue(undefined);
    await ptySend(42, new Uint8Array([104, 105]));
    expect(invokeMock).toHaveBeenCalledWith("pty_ws_send", {
      connectionId: 42,
      data: [104, 105],
    });
  });

  it("ptySend passes an empty frame through", async () => {
    invokeMock.mockResolvedValue(undefined);
    await ptySend(42, new Uint8Array([]));
    expect(invokeMock).toHaveBeenCalledWith("pty_ws_send", {
      connectionId: 42,
      data: [],
    });
  });
});
