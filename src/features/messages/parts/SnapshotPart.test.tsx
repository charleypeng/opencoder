// L2 tests for the snapshot part (TASK-M3-02): the marker chip with
// camera icon, "Snapshot" label, short snapshot id and the M6 revert
// tooltip, plus a snapshot of the fixture's snapshot part.

import { describe, expect, it } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import SnapshotPart, { type SnapshotPartData } from "./SnapshotPart";
import allPartsFixtureJson from "../../../../tests/fixtures/message.stream.all-parts.json";

function snapshotPart(snapshot: string): SnapshotPartData {
  return {
    id: "prt_snap",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "snapshot",
    snapshot,
  } as SnapshotPartData;
}

describe("SnapshotPart", () => {
  it("renders the snapshot marker with label and short id", () => {
    render(() => <SnapshotPart part={snapshotPart("snp_a1b2c3d4")} />);
    const chip = screen.getByTestId("snapshot-part");
    expect(chip).toHaveTextContent("Snapshot");
    expect(screen.getByTestId("snapshot-id")).toHaveTextContent("snp_a1b2c3d4");
  });

  it("truncates long snapshot ids", () => {
    render(() => (
      <SnapshotPart part={snapshotPart("snp_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")} />
    ));
    expect(screen.getByTestId("snapshot-id")).toHaveTextContent("snp_a1b2c3d4");
  });

  it("keeps the M6 revert hint on the chip", () => {
    render(() => <SnapshotPart part={snapshotPart("snp_a1b2c3d4")} />);
    expect(screen.getByTestId("snapshot-part")).toHaveAttribute(
      "title",
      expect.stringContaining("M6"),
    );
  });
});

describe("SnapshotPart snapshot", () => {
  it("matches the fixture's snapshot part", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p11") as
      SnapshotPartData | undefined;
    expect(fixturePart).toBeDefined();
    const { container } = render(() => <SnapshotPart part={fixturePart as SnapshotPartData} />);
    expect(container).toMatchSnapshot();
  });
});
