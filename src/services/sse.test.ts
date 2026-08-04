// L1 tests for the SSE subscription facade (TASK-M1-02): Channel payload
// normalization (single / batch / __raw) and unsubscribe dispatch.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SseEvent } from "./sse.js";

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

import { sseSubscribe } from "./sse.js";

interface ChannelArgs {
  channel: { onmessage?: (message: unknown) => void };
  [key: string]: unknown;
}

function subscribe(events: SseEvent[]): {
  channel: () => { onmessage?: (message: unknown) => void };
} {
  let channel: { onmessage?: (message: unknown) => void } | undefined;
  invokeMock.mockImplementation((_command: string, args: unknown) => {
    channel = (args as ChannelArgs).channel;
    return Promise.resolve(1);
  });
  void sseSubscribe("srv-1", undefined, (event) => events.push(event));
  return {
    channel: () => {
      if (!channel) throw new Error("channel not captured");
      return channel;
    },
  };
}

describe("sseSubscribe", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("invokes sse_subscribe with serverId, directory and a channel", async () => {
    invokeMock.mockResolvedValue(7);
    const unsubscribe = await sseSubscribe("srv-1", "/proj", () => {});
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("sse_subscribe", {
      serverId: "srv-1",
      directory: "/proj",
      channel: expect.any(ChannelMock),
      auth: undefined,
    });
    expect(typeof unsubscribe).toBe("function");
  });

  it("passes auth through when provided", async () => {
    invokeMock.mockResolvedValue(1);
    await sseSubscribe("srv-1", undefined, () => {}, {
      auth: { username: "user", password: "pass" },
    });
    expect(invokeMock.mock.calls[0][1]).toMatchObject({
      auth: { username: "user", password: "pass" },
    });
  });

  it("delivers single events in order", () => {
    const received: SseEvent[] = [];
    const { channel } = subscribe(received);

    channel().onmessage?.({ id: "a", type: "message.part.delta", properties: { delta: "x" } });
    channel().onmessage?.({ id: "b", type: "session.idle", properties: {} });
    expect(received).toEqual([
      { id: "a", type: "message.part.delta", properties: { delta: "x" } },
      { id: "b", type: "session.idle", properties: {} },
    ]);
  });

  it("expands batch arrays preserving order", () => {
    const received: SseEvent[] = [];
    const { channel } = subscribe(received);

    channel().onmessage?.([
      { id: "1", type: "session.created", properties: {} },
      { id: "2", type: "message.part.delta", properties: { delta: "y" } },
      { id: "3", type: "session.idle", properties: {} },
    ]);
    expect(received).toEqual([
      { id: "1", type: "session.created", properties: {} },
      { id: "2", type: "message.part.delta", properties: { delta: "y" } },
      { id: "3", type: "session.idle", properties: {} },
    ]);
  });

  it("lazy-parses __raw payloads and skips malformed ones", () => {
    const received: SseEvent[] = [];
    const { channel } = subscribe(received);

    channel().onmessage?.([
      { __raw: '{"id":"r1","type":"session.created","properties":{}}' },
      { __raw: "not json" },
      { id: "ok", type: "session.idle", properties: {} },
    ]);
    expect(received).toEqual([
      { id: "r1", type: "session.created", properties: {} },
      { id: "ok", type: "session.idle", properties: {} },
    ]);
  });

  it("skips non-event noise", () => {
    const received: SseEvent[] = [];
    const { channel } = subscribe(received);

    channel().onmessage?.(null);
    channel().onmessage?.("unexpected");
    channel().onmessage?.({});
    expect(received).toEqual([]);
  });

  it("unsubscribe invokes sse_unsubscribe with the subscription id", async () => {
    invokeMock.mockResolvedValue(42);
    const unsubscribe = await sseSubscribe("srv-1", undefined, () => {});
    await unsubscribe();
    expect(invokeMock).toHaveBeenLastCalledWith("sse_unsubscribe", { subscriptionId: 42 });
  });
});
