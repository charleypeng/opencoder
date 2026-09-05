import { beforeEach, describe, expect, it } from "vitest";
import {
  clearActivityViewState,
  readActivityExpanded,
  readActivityEntryExpanded,
  writeActivityEntryExpanded,
  writeActivityExpanded,
} from "./activityViewState";

beforeEach(() => clearActivityViewState());

describe("activity view state", () => {
  it("defaults each trace to collapsed and isolates keys", () => {
    expect(readActivityExpanded("server:session:message-1")).toBe(false);
    writeActivityExpanded("server:session:message-1", true);
    expect(readActivityExpanded("server:session:message-1")).toBe(true);
    expect(readActivityExpanded("server:session:message-2")).toBe(false);
  });

  it("can clear transient choices after the conversation scope changes", () => {
    writeActivityExpanded("server:session:message-1", true);
    clearActivityViewState();
    expect(readActivityExpanded("server:session:message-1")).toBe(false);
  });

  it("keeps individual entries scoped to their run", () => {
    writeActivityEntryExpanded("server:session:run-1", "part-1", true);
    expect(readActivityEntryExpanded("server:session:run-1", "part-1")).toBe(true);
    expect(readActivityEntryExpanded("server:session:run-1", "part-2")).toBe(false);
    expect(readActivityEntryExpanded("server:session:run-2", "part-1")).toBe(false);

    writeActivityEntryExpanded("server:session:run-1", "part-1", false);
    expect(readActivityEntryExpanded("server:session:run-1", "part-1")).toBe(false);
  });

  it("uses the supplied fallback until the user chooses a top-level state", () => {
    expect(readActivityExpanded("server:session:live-run", true)).toBe(true);
    writeActivityExpanded("server:session:live-run", false);
    expect(readActivityExpanded("server:session:live-run", true)).toBe(false);
  });
});
