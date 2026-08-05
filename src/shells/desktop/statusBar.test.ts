// L1 tests for the status bar helpers (TASK-M9-07): the tokens/cost
// formatting and the session usage derivation (server-computed Session
// tokens/cost fields; cache reads/writes excluded from the usage figure).

import { describe, expect, it } from "vitest";
import { formatCost, formatTokens, usageOf } from "./statusBar.js";
import type { Session } from "../../services/session.js";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_1",
    slug: "s",
    directory: "/x",
    time: { created: 1, updated: 1 },
    ...overrides,
  } as Session;
}

describe("formatTokens", () => {
  it("keeps small counts verbatim and rounds thousands", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(12)).toBe("12");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(1234)).toBe("1.2K");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });

  it("guards undefined / non-finite values", () => {
    expect(formatTokens(undefined)).toBe("0");
    expect(formatTokens(Number.NaN)).toBe("0");
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("formatCost", () => {
  it("formats dollars with two decimals", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.05)).toBe("$0.05");
    expect(formatCost(1.234)).toBe("$1.23");
  });

  it("guards undefined / non-finite values", () => {
    expect(formatCost(undefined)).toBe("$0.00");
    expect(formatCost(Number.NaN)).toBe("$0.00");
  });
});

describe("usageOf", () => {
  it("sums input + output + reasoning tokens and reads the cost", () => {
    const s = session({
      tokens: { input: 1000, output: 500, reasoning: 200, cache: { read: 9000, write: 100 } },
      cost: 0.042,
    });
    expect(usageOf(s)).toEqual({ tokens: 1700, cost: 0.042 });
  });

  it("returns undefined for a session without tokens", () => {
    expect(usageOf(session())).toBeUndefined();
    expect(usageOf(undefined)).toBeUndefined();
  });

  it("returns undefined when both figures are zero (nothing reported yet)", () => {
    expect(
      usageOf(
        session({
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
        }),
      ),
    ).toBeUndefined();
    expect(
      usageOf(
        session({
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.01,
        }),
      ),
    ).toEqual({ tokens: 0, cost: 0.01 });
  });
});
