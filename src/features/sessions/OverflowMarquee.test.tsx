import { describe, expect, it } from "vitest";
import { marqueeOverflowPx } from "./OverflowMarquee";

describe("marqueeOverflowPx", () => {
  it("activates only when the title exceeds its available width", () => {
    expect(marqueeOverflowPx(160, 160)).toBe(0);
    expect(marqueeOverflowPx(160, 161)).toBe(0);
    expect(marqueeOverflowPx(160, 220)).toBe(59);
  });
});
