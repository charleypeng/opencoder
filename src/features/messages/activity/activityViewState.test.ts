import { beforeEach, describe, expect, it } from "vitest";
import {
  clearActivityViewState,
  readActivityExpanded,
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
});
