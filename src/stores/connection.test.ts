// L1 tests for the connection store (TASK-M1-04): applyServerHealth
// transitions (add / update / ok / slow / down shapes) and the
// subscribeToServerHealth event wiring.

import { afterEach, describe, expect, it, vi } from "vitest";

type HealthPayload = {
  serverId: string;
  healthy: boolean;
  version?: string;
  latencyMs?: number;
  status: "ok" | "slow" | "down";
  lastOk?: number;
  failCount: number;
};

type ListenFn = (
  event: string,
  handler: (event: { payload: HealthPayload }) => void,
) => Promise<() => void>;

const { listenMock } = vi.hoisted(() => {
  const listenMock = vi.fn<ListenFn>(() => Promise.resolve(() => {}));
  return { listenMock };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

import { applyServerHealth, connections, subscribeToServerHealth } from "./connection.js";

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
  listenMock.mockClear();
});

describe("connection store", () => {
  it("applies a healthy server snapshot (ok shape)", () => {
    applyServerHealth({
      serverId: "srv-ok",
      healthy: true,
      version: "1.18.11-mock",
      latencyMs: 12,
      status: "ok",
      failCount: 0,
      lastOk: 1_700_000_000_000,
    });
    expect(connections["srv-ok"]).toMatchObject({
      serverId: "srv-ok",
      healthy: true,
      version: "1.18.11-mock",
      latencyMs: 12,
      status: "ok",
      failCount: 0,
      lastOk: 1_700_000_000_000,
    });
  });

  it("updates an existing entry with a slow shape", () => {
    applyServerHealth({
      serverId: "srv-slow",
      healthy: true,
      latencyMs: 1400,
      status: "slow",
      failCount: 0,
    });
    applyServerHealth({
      serverId: "srv-slow",
      healthy: true,
      latencyMs: 1600,
      status: "slow",
      failCount: 0,
    });
    expect(connections["srv-slow"]).toMatchObject({
      latencyMs: 1600,
      status: "slow",
    });
  });

  it("records a down shape", () => {
    applyServerHealth({
      serverId: "srv-down",
      healthy: false,
      status: "down",
      failCount: 3,
    });
    expect(connections["srv-down"]).toMatchObject({
      healthy: false,
      status: "down",
      failCount: 3,
    });
  });

  it("keeps multiple servers independent", () => {
    applyServerHealth({
      serverId: "srv-a",
      healthy: true,
      status: "ok",
      failCount: 0,
    });
    applyServerHealth({
      serverId: "srv-b",
      healthy: false,
      status: "down",
      failCount: 3,
    });
    expect(connections["srv-a"]?.healthy).toBe(true);
    expect(connections["srv-b"]?.healthy).toBe(false);
  });
});

describe("subscribeToServerHealth", () => {
  it("subscribes to server-health and applies payloads to the store", async () => {
    window.__TAURI_INTERNALS__ = {};
    const unlisten = subscribeToServerHealth();
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith("server-health", expect.any(Function));

    const handler = listenMock.mock.calls[0][1];
    handler({ payload: { serverId: "srv-event", healthy: true, status: "ok", failCount: 0 } });
    expect(connections["srv-event"]).toMatchObject({ healthy: true, status: "ok" });

    unlisten();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("returns a no-op outside Tauri without calling listen", () => {
    const unlisten = subscribeToServerHealth();
    expect(listenMock).not.toHaveBeenCalled();
    expect(unlisten()).toBeUndefined();
  });
});
