// L1 tests for the log forwarding engine (TASK-M9-07): the `oc-diagnostics`
// pref persistence, the capture-to-POST /log pipeline (flush on batch size,
// flush on the 30s interval, drain on stop), in-batch dedupe and the
// idempotent start/stop discipline.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forwardLogsEnabled,
  loadDiagnosticsPrefs,
  saveDiagnosticsPrefs,
  setLogForwarding,
  startLogForwarding,
  stopLogForwarding,
} from "./logForward.js";
import { clearLogEntries, installLogCapture, logCapture } from "./logCapture.js";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));
vi.mock("../../../services/client.js", () => ({ getApiClient: getApiClientMock }));

function mockClient() {
  const posts: Array<{ path: string; body: unknown }> = [];
  const client = {
    post: vi.fn(async (path: string, options: { body?: unknown } = {}) => {
      posts.push({ path, body: options.body });
      return true;
    }),
    get: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return { client, posts };
}

beforeEach(() => {
  localStorage.clear();
  stopLogForwarding();
  vi.useFakeTimers();
  clearLogEntries();
  logCapture.nextId = 1;
});

afterEach(() => {
  stopLogForwarding();
  clearLogEntries();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("diagnostics prefs", () => {
  it("defaults forwarding to off", () => {
    expect(loadDiagnosticsPrefs()).toEqual({});
    expect(forwardLogsEnabled()).toBe(false);
  });

  it("persists and reads the forwardLogs flag", () => {
    saveDiagnosticsPrefs({ forwardLogs: true });
    expect(loadDiagnosticsPrefs()).toEqual({ forwardLogs: true });
    expect(forwardLogsEnabled()).toBe(true);
    saveDiagnosticsPrefs({ forwardLogs: false });
    expect(forwardLogsEnabled()).toBe(false);
  });

  it("ignores malformed payloads", () => {
    localStorage.setItem("oc-diagnostics", "{oops");
    expect(loadDiagnosticsPrefs()).toEqual({});
    localStorage.setItem("oc-diagnostics", JSON.stringify({ forwardLogs: "yes" }));
    expect(loadDiagnosticsPrefs()).toEqual({});
  });
});

describe("log forwarding pipeline", () => {
  it("flushes captured entries to POST /log on the 30s interval", () => {
    const { posts } = mockClient();
    const stopCapture = installLogCapture();
    startLogForwarding();
    console.error("interval flush");
    expect(posts.length).toBe(0);
    vi.advanceTimersByTime(30_000);
    expect(posts.length).toBe(1);
    expect(posts[0]).toEqual({
      path: "/log",
      body: { service: "opencoder-webview", level: "error", message: "interval flush" },
    });
    stopCapture();
  });

  it("flushes when the queue reaches 20 entries without waiting", () => {
    const { posts } = mockClient();
    const stopCapture = installLogCapture();
    startLogForwarding();
    for (let i = 0; i < 20; i += 1) console.error(`batch ${i}`);
    // One POST per entry (the contract accepts a single entry per request).
    expect(posts.length).toBe(20);
    expect(posts[0].body).toMatchObject({
      service: "opencoder-webview",
      level: "error",
      message: "batch 0",
    });
    expect(posts[19].body).toMatchObject({ message: "batch 19" });
    // The queue is drained: nothing is pending for the next interval tick.
    vi.advanceTimersByTime(30_000);
    expect(posts.length).toBe(20);
    stopCapture();
  });

  it("drains the queue on stop and stops forwarding afterwards", () => {
    const { posts } = mockClient();
    const stopCapture = installLogCapture();
    const stop = startLogForwarding();
    console.error("drain me");
    expect(posts.length).toBe(0);
    stop();
    expect(posts.length).toBe(1);
    console.error("after stop");
    expect(posts.length).toBe(1);
    stopCapture();
  });

  it("dedupes identical entries within one batch", () => {
    const { posts } = mockClient();
    const stopCapture = installLogCapture();
    startLogForwarding();
    console.error("same");
    console.error("same");
    console.warn("same");
    vi.advanceTimersByTime(30_000);
    expect(posts.length).toBe(2);
    expect(posts[0].body).toMatchObject({ level: "error", message: "same" });
    expect(posts[1].body).toMatchObject({ level: "warn", message: "same" });
    stopCapture();
  });

  it("start is idempotent; a failure never surfaces an unhandled rejection", async () => {
    const { client } = mockClient();
    client.post.mockRejectedValue(new Error("server down"));
    const stopCapture = installLogCapture();
    const stop = startLogForwarding();
    expect(startLogForwarding()).toBe(stop);
    console.error("lost batch");
    vi.advanceTimersByTime(30_000);
    // The rejected flush is swallowed; the queue was dropped with it.
    await Promise.resolve();
    stop();
    stopCapture();
  });

  it("setLogForwarding persists the pref and starts/stops the engine", () => {
    const { posts } = mockClient();
    const stopCapture = installLogCapture();
    setLogForwarding(true);
    expect(forwardLogsEnabled()).toBe(true);
    console.error("toggled on");
    vi.advanceTimersByTime(30_000);
    expect(posts.length).toBe(1);
    setLogForwarding(false);
    expect(forwardLogsEnabled()).toBe(false);
    console.error("toggled off");
    vi.advanceTimersByTime(30_000);
    expect(posts.length).toBe(1);
    stopCapture();
  });
});
