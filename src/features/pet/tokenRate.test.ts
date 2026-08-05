// L1 tests for the token rate store (TASK-M8-08): the sliding per-second
// delta window (bumpTokenRate / auto-decay), the rate -> intensity
// mapping that drives the pet's working animation speed, and the reset
// used by test teardown.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bumpTokenRate,
  resetTokenRate,
  TOKEN_WINDOW_MS,
  tokenRateStore,
  workingIntensity,
} from "./tokenRate";

const DECAY_STEP = 250;

describe("tokenRate store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    resetTokenRate();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTokenRate();
  });

  it("counts deltas inside the sliding window", () => {
    bumpTokenRate();
    bumpTokenRate();
    bumpTokenRate();
    expect(tokenRateStore.rate).toBe(3);
  });

  it("slides the window: deltas older than a second drop out", () => {
    bumpTokenRate();
    vi.advanceTimersByTime(TOKEN_WINDOW_MS - 1);
    bumpTokenRate();
    // Two deltas in the window (the first still inside).
    expect(tokenRateStore.rate).toBe(2);
    vi.advanceTimersByTime(1);
    // The first delta fell out; the decay interval publishes the prune.
    bumpTokenRate();
    expect(tokenRateStore.rate).toBe(2);
  });

  it("decays to zero on its own after a burst", () => {
    bumpTokenRate();
    bumpTokenRate();
    expect(tokenRateStore.rate).toBe(2);
    vi.advanceTimersByTime(TOKEN_WINDOW_MS + DECAY_STEP);
    expect(tokenRateStore.rate).toBe(0);
  });

  it("reset clears the window", () => {
    bumpTokenRate();
    resetTokenRate();
    expect(tokenRateStore.rate).toBe(0);
  });
});

describe("workingIntensity", () => {
  it("maps the rate to 0-100", () => {
    expect(workingIntensity(0)).toBe(0);
    expect(workingIntensity(1)).toBe(4);
    expect(workingIntensity(5)).toBe(20);
    expect(workingIntensity(12.5)).toBe(50);
    expect(workingIntensity(25)).toBe(100);
    expect(workingIntensity(40)).toBe(100);
  });

  it("clamps garbage input to zero", () => {
    expect(workingIntensity(-3)).toBe(0);
    expect(workingIntensity(Number.NaN)).toBe(0);
    expect(workingIntensity(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
