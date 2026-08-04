// L1 tests for the OAuth auto-flow polling helper (TASK-M5-07): pollUntil
// checks immediately and then every intervalMs until the check succeeds,
// the timeout elapses, or the signal aborts — with a rejected check
// counting as a failed attempt that keeps polling.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollUntil } from "./oauth.js";

describe("pollUntil", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves true when the check succeeds on the first attempt", async () => {
    const fn = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);

    const promise = pollUntil(fn, { intervalMs: 2000, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).resolves.toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps polling at the interval until the check succeeds", async () => {
    const fn = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const promise = pollUntil(fn, { intervalMs: 2000, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("resolves false once the timeout deadline passes", async () => {
    const fn = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);

    const promise = pollUntil(fn, { intervalMs: 2000, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(6000);

    await expect(promise).resolves.toBe(false);
    const callsAtTimeout = fn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn.mock.calls.length).toBe(callsAtTimeout);
  });

  it("stops polling and resolves false when the signal aborts", async () => {
    const controller = new AbortController();
    const fn = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);

    const promise = pollUntil(fn, {
      intervalMs: 2000,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(fn.mock.calls.length).toBeGreaterThan(1);

    controller.abort();
    await expect(promise).resolves.toBe(false);
    const callsAtAbort = fn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn.mock.calls.length).toBe(callsAtAbort);
  });

  it("never polls when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);

    const promise = pollUntil(fn, {
      intervalMs: 2000,
      timeoutMs: 60_000,
      signal: controller.signal,
    });

    await expect(promise).resolves.toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps polling when a check rejects (transient failure)", async () => {
    const fn = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const promise = pollUntil(fn, { intervalMs: 2000, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(4000);

    await expect(promise).resolves.toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
