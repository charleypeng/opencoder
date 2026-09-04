import { describe, expect, it } from "vitest";
import { marqueeDurationSeconds, marqueeOverflowPx } from "./OverflowMarquee";

describe("marqueeOverflowPx", () => {
  it("activates only when the title exceeds its available width", () => {
    expect(marqueeOverflowPx(160, 160)).toBe(0);
    expect(marqueeOverflowPx(160, 161)).toBe(0);
    expect(marqueeOverflowPx(160, 220)).toBe(59);
  });

  it("moves titles 20% faster than the previous accelerated timing", () => {
    expect(marqueeDurationSeconds(0)).toBeCloseTo(6 / 1.56);
    expect(marqueeDurationSeconds(280)).toBeCloseTo(10 / 1.56);
  });
});
