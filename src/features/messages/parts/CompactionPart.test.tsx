// L2 tests for the compaction notice (TASK-M3-04): CompactionPart renders
// the "Context compacted" system line, expands to the schema-provided
// detail (mode, overflow flag, tail part id) and stands alone without a
// toggle when the part carries no detail fields. Snapshots come from the
// all-parts fixture's compaction part (prt_p9).

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import CompactionPart from "./CompactionPart";
import type { CompactionPartData } from "./CompactionPart";
import allPartsFixtureJson from "../../../../tests/fixtures/message.stream.all-parts.json";

function compactionPart(overrides: Partial<CompactionPartData> = {}): CompactionPartData {
  return {
    id: "prt_compaction",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "compaction",
    auto: true,
    ...overrides,
  };
}

describe("CompactionPart", () => {
  it("renders the compacted system line from the fixture part", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p9") as
      CompactionPartData | undefined;
    expect(fixturePart).toBeDefined();
    render(() => <CompactionPart part={fixturePart as CompactionPartData} />);

    expect(screen.getByTestId("compaction-part")).toHaveTextContent("Context compacted");
  });

  it("expands to the detail rows and collapses again", () => {
    render(() => (
      <CompactionPart
        part={compactionPart({ auto: true, overflow: true, tail_start_id: "prt_p8" })}
      />
    ));

    const toggle = screen.getByTestId("compaction-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("compaction-detail")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("compaction-mode")).toHaveTextContent("Auto compaction");
    expect(screen.getByTestId("compaction-overflow")).toHaveTextContent("Context overflowed");
    expect(screen.getByTestId("compaction-tail")).toHaveTextContent("prt_p8");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("compaction-detail")).not.toBeInTheDocument();
  });

  it("renders manual mode and omits missing detail rows", () => {
    render(() => <CompactionPart part={compactionPart({ auto: false, overflow: true })} />);

    fireEvent.click(screen.getByTestId("compaction-toggle"));
    expect(screen.getByTestId("compaction-mode")).toHaveTextContent("Manual compaction");
    expect(screen.queryByTestId("compaction-tail")).not.toBeInTheDocument();
  });

  it("renders the line alone without a toggle when there is no detail", () => {
    render(() => <CompactionPart part={compactionPart({ auto: false })} />);

    expect(screen.getByTestId("compaction-part")).toHaveTextContent("Context compacted");
    expect(screen.queryByTestId("compaction-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("compaction-detail")).not.toBeInTheDocument();
  });
});

describe("CompactionPart snapshot", () => {
  it("matches the fixture's compaction part", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p9") as
      CompactionPartData | undefined;
    expect(fixturePart).toBeDefined();
    const { container } = render(() => <CompactionPart part={fixturePart as CompactionPartData} />);
    expect(container).toMatchSnapshot();
  });
});
