// L1 tests for the relative-time helper (TASK-M1-06).

import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relativeTime";

const NOW = 1_700_000_000_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

describe("formatRelativeTime", () => {
  it('renders "just now" for the last minute', () => {
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe("just now");
  });

  it("renders minutes, hours and days", () => {
    expect(formatRelativeTime(NOW - 5 * MINUTE_MS, NOW)).toBe("5m ago");
    expect(formatRelativeTime(NOW - 2 * HOUR_MS, NOW)).toBe("2h ago");
    expect(formatRelativeTime(NOW - 3 * DAY_MS, NOW)).toBe("3d ago");
  });

  it("falls back to a locale date beyond a week", () => {
    const past = NOW - 30 * DAY_MS;
    expect(formatRelativeTime(past, NOW)).toBe(new Date(past).toLocaleDateString());
  });

  it("clamps future timestamps to just now", () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe("just now");
  });
});
