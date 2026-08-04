// L1 tests for the mDNS discovery wrappers (TASK-M1-07): invoke command
// names and payload forwarding, the non-Tauri no-op guard and the
// `server-discovered` subscription helper.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDiscoveredServers,
  startMdnsDiscovery,
  stopMdnsDiscovery,
  subscribeToServerDiscovered,
} from "./discovery";
import type { DiscoveredServer } from "./discovery";
import { ApiError } from "./errors";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

function withTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

function withoutTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, configurable: true });
}

const server: DiscoveredServer = {
  id: "opencode-14096._http._tcp.local.",
  name: "opencode-14096",
  url: "http://192.168.1.5:14096",
  host: "192.168.1.5",
  port: 14096,
};

describe("discovery commands", () => {
  afterEach(() => {
    vi.clearAllMocks();
    withoutTauri();
  });

  it("starts and stops the scan through the right commands", async () => {
    withTauri();
    invokeMock.mockResolvedValue(undefined);
    await startMdnsDiscovery();
    expect(invokeMock).toHaveBeenCalledWith("start_mdns_discovery");
    await stopMdnsDiscovery();
    expect(invokeMock).toHaveBeenCalledWith("stop_mdns_discovery");
  });

  it("returns the cached servers from get_discovered_servers", async () => {
    withTauri();
    invokeMock.mockResolvedValue([server]);
    await expect(getDiscoveredServers()).resolves.toEqual([server]);
    expect(invokeMock).toHaveBeenCalledWith("get_discovered_servers");
  });

  it("normalizes command rejections to ApiError", async () => {
    withTauri();
    invokeMock.mockRejectedValue({ code: "ipc", message: "boom", retriable: false });
    const error = await startMdnsDiscovery().then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("boom");
  });

  it("no-ops outside Tauri without invoking commands", async () => {
    withoutTauri();
    await expect(startMdnsDiscovery()).resolves.toBeUndefined();
    await expect(stopMdnsDiscovery()).resolves.toBeUndefined();
    await expect(getDiscoveredServers()).resolves.toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("subscribeToServerDiscovered", () => {
  afterEach(() => {
    vi.clearAllMocks();
    withoutTauri();
  });

  it("subscribes to server-discovered and forwards the payload", async () => {
    withTauri();
    const handler = vi.fn();
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const stop = subscribeToServerDiscovered(handler);
    expect(listenMock).toHaveBeenCalledWith("server-discovered", expect.any(Function));
    const [, callback] = listenMock.mock.calls[0];
    callback({ payload: server });
    expect(handler).toHaveBeenCalledWith(server);

    stop();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalled();
  });

  it("returns a no-op unlisten outside Tauri", () => {
    withoutTauri();
    const stop = subscribeToServerDiscovered(vi.fn());
    expect(listenMock).not.toHaveBeenCalled();
    stop();
    expect(listenMock).not.toHaveBeenCalled();
  });
});
