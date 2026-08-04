// L1 tests for the streaming indicator hook (TASK-M2-09): a session counts
// as streaming only while it is busy/retry AND a part mutation landed within
// the 5-second window; the 1s ticker closes the window and cleans up.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import { applyTextDelta, resetServer as resetMessages } from "../../stores/messages";
import { resetServer as resetSessions, setSessionStatus } from "../../stores/session";
import { STREAMING_WINDOW_MS, useStreamingIndicator } from "./useStreamingIndicator";

const SERVER = "srv-stream";
const SESSION = "ses_stream_1";

function createProbe() {
  let result: { streaming: () => boolean; busy: () => boolean } | undefined;
  createRoot(() => {
    result = useStreamingIndicator(
      () => SERVER,
      () => SESSION,
    );
  });
  return result as { streaming: () => boolean; busy: () => boolean };
}

beforeEach(() => {
  resetMessages(SERVER);
  resetSessions(SERVER);
});

afterEach(() => {
  resetMessages(SERVER);
  resetSessions(SERVER);
  vi.useRealTimers();
});

describe("useStreamingIndicator", () => {
  it("is idle without a session status or deltas", () => {
    const probe = createProbe();
    expect(probe.busy()).toBe(false);
    expect(probe.streaming()).toBe(false);
  });

  it("busy alone is not streaming without recent deltas", () => {
    setSessionStatus(SERVER, SESSION, { type: "busy" });
    const probe = createProbe();
    expect(probe.busy()).toBe(true);
    expect(probe.streaming()).toBe(false);
  });

  it("streams while busy and deltas are recent, then closes the window", () => {
    vi.useFakeTimers();
    setSessionStatus(SERVER, SESSION, { type: "busy" });
    const probe = createProbe();
    applyTextDelta(SERVER, SESSION, {
      messageID: "msg_1",
      partID: "prt_1",
      field: "text",
      delta: "tok",
    });
    expect(probe.streaming()).toBe(true);

    // A delta inside the window keeps it alive.
    vi.advanceTimersByTime(3000);
    applyTextDelta(SERVER, SESSION, {
      messageID: "msg_1",
      partID: "prt_1",
      field: "text",
      delta: " more",
    });
    expect(probe.streaming()).toBe(true);

    // Silence past the window closes it.
    vi.advanceTimersByTime(STREAMING_WINDOW_MS + 1000);
    expect(probe.streaming()).toBe(false);
  });

  it("stops streaming when the session turns idle even with fresh deltas", () => {
    vi.useFakeTimers();
    setSessionStatus(SERVER, SESSION, { type: "busy" });
    const probe = createProbe();
    applyTextDelta(SERVER, SESSION, {
      messageID: "msg_1",
      partID: "prt_1",
      field: "text",
      delta: "tok",
    });
    expect(probe.streaming()).toBe(true);

    setSessionStatus(SERVER, SESSION, { type: "idle" });
    expect(probe.busy()).toBe(false);
    expect(probe.streaming()).toBe(false);
  });

  it("retry counts as busy", () => {
    setSessionStatus(SERVER, SESSION, { type: "retry", attempt: 1, message: "retry", next: 5 });
    const probe = createProbe();
    expect(probe.busy()).toBe(true);
  });
});
