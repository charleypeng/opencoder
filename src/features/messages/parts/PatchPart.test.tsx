// L2 tests for the patch part (TASK-M3-02): header with short hash and
// total file count, one row per patched file, the onOpenDiff callback
// (wired by M4) and the no-handler no-op, plus a snapshot of the
// fixture's patch part.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import PatchPart, { type PatchPartData } from "./PatchPart";
import allPartsFixtureJson from "../../../../tests/fixtures/message.stream.all-parts.json";

const HASH = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

function patchPart(files: string[]): PatchPartData {
  return {
    id: "prt_patch",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "patch",
    hash: HASH,
    files,
  } as PatchPartData;
}

describe("PatchPart", () => {
  it("renders the header with short hash and file count", () => {
    render(() => <PatchPart part={patchPart(["src/auth/login.ts", "src/auth/session.ts"])} />);
    const card = screen.getByTestId("patch-part");
    expect(card).toHaveTextContent("Patch");
    expect(screen.getByTestId("patch-hash")).toHaveTextContent("a1b2c3d");
    expect(screen.getByTestId("patch-count")).toHaveTextContent("2 files");
  });

  it("renders one row per patched file", () => {
    render(() => <PatchPart part={patchPart(["src/auth/login.ts", "src/auth/session.ts"])} />);
    const rows = screen.getAllByTestId("patch-file");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("src/auth/login.ts");
    expect(rows[1]).toHaveTextContent("src/auth/session.ts");
  });

  it("emits onOpenDiff with the file on row click", () => {
    const onOpenDiff = vi.fn();
    render(() => <PatchPart part={patchPart(["src/auth/login.ts"])} onOpenDiff={onOpenDiff} />);
    fireEvent.click(screen.getByTestId("patch-file"));
    expect(onOpenDiff).toHaveBeenCalledWith("src/auth/login.ts");
  });

  it("is a no-op without an onOpenDiff handler (M4 wires it)", () => {
    render(() => <PatchPart part={patchPart(["src/auth/login.ts"])} />);
    expect(() => fireEvent.click(screen.getByTestId("patch-file"))).not.toThrow();
  });
});

describe("PatchPart snapshot", () => {
  it("matches the fixture's patch part", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p10") as
      PatchPartData | undefined;
    expect(fixturePart).toBeDefined();
    const { container } = render(() => <PatchPart part={fixturePart as PatchPartData} />);
    expect(container).toMatchSnapshot();
  });
});
