// L2 tests for the step boundary parts (TASK-M3-03): StepStartPart renders
// the thin divider with the "Step" label plus the short start-snapshot id
// when the part carries one; StepFinishPart renders the "Step complete" meta
// row with reason, formatted token count and USD cost; formatTokens unit
// cases cover the k/M rounding rules. Snapshots come from the all-parts
// fixture's step parts (prt_p1, prt_p12).

import { describe, expect, it } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { formatTokens, StepFinishPart, StepStartPart } from "./StepPart";
import type { StepFinishPartData, StepStartPartData } from "./StepPart";
import allPartsFixtureJson from "../../../../tests/fixtures/message.stream.all-parts.json";

function startPart(snapshot?: string): StepStartPartData {
  return {
    id: "prt_step_start",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "step-start",
    ...(snapshot !== undefined ? { snapshot } : {}),
  };
}

function finishPart(overrides: Partial<StepFinishPartData> = {}): StepFinishPartData {
  return {
    id: "prt_step_finish",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "step-finish",
    reason: "completed",
    cost: 0.42,
    tokens: {
      total: 12000,
      input: 10000,
      output: 2000,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    ...overrides,
  };
}

describe("formatTokens", () => {
  it("keeps counts below 1000 as integers without a suffix", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("rounds thousands to one decimal with a k suffix", () => {
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(12300)).toBe("12.3k");
  });

  it("formats millions with an M suffix", () => {
    expect(formatTokens(1_234_567)).toBe("1.23M");
  });

  it("falls back to 0 for non-finite counts", () => {
    expect(formatTokens(Number.NaN)).toBe("0");
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("StepStartPart", () => {
  it("renders the thin divider with the Step label and no snapshot hint", () => {
    render(() => <StepStartPart part={startPart()} />);
    const divider = screen.getByTestId("step-start-part");
    expect(divider).toHaveTextContent("Step");
    expect(screen.queryByTestId("step-start-snapshot")).not.toBeInTheDocument();
  });

  it("shows the short start-snapshot id when the part carries one", () => {
    render(() => <StepStartPart part={startPart("snp_a1b2c3d4e5f6a7b8")} />);
    expect(screen.getByTestId("step-start-snapshot")).toHaveTextContent("snp_a1b2c3d4");
  });
});

describe("StepFinishPart", () => {
  it("renders the meta row with reason, formatted tokens and USD cost", () => {
    render(() => (
      <StepFinishPart
        part={finishPart({
          tokens: {
            input: 1234,
            output: 567,
            reasoning: 89,
            cache: { read: 100, write: 50 },
          },
        })}
      />
    ));
    const meta = screen.getByTestId("step-finish-part");
    expect(meta).toHaveTextContent("Step complete");
    expect(screen.getByTestId("step-finish-reason")).toHaveTextContent("Completed");
    expect(screen.getByTestId("step-finish-tokens")).toHaveTextContent("1.8k tokens");
    expect(screen.getByTestId("step-finish-cost")).toHaveTextContent("$0.42");
  });

  it("prefers the total token count and keeps small costs precise", () => {
    render(() => <StepFinishPart part={finishPart({ cost: 0.012 })} />);
    expect(screen.getByTestId("step-finish-tokens")).toHaveTextContent("12k tokens");
    expect(screen.getByTestId("step-finish-cost")).toHaveTextContent("$0.012");
  });
});

describe("Step parts snapshots", () => {
  it("matches the fixture's step-start part", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p1") as
      StepStartPartData | undefined;
    expect(fixturePart).toBeDefined();
    const { container } = render(() => <StepStartPart part={fixturePart as StepStartPartData} />);
    expect(container).toMatchSnapshot();
  });

  it("matches the fixture's step-finish part", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p12") as
      StepFinishPartData | undefined;
    expect(fixturePart).toBeDefined();
    const { container } = render(() => <StepFinishPart part={fixturePart as StepFinishPartData} />);
    expect(container).toMatchSnapshot();
  });
});
