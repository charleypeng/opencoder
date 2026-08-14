// L1 tests for the explicit per-server workspace list (workspace layout
// redesign): add/read/remove round-trips, dedupe, per-server isolation and
// malformed-storage tolerance.

import { beforeEach, describe, expect, it } from "vitest";
import { addWorkspace, readWorkspaces, removeWorkspace } from "./workspaces.js";

const SERVER = "srv-ws";

beforeEach(() => {
  localStorage.clear();
});

describe("workspaces", () => {
  it("reads an empty list when nothing was added", () => {
    expect(readWorkspaces(SERVER)).toEqual([]);
  });

  it("round-trips added workspaces in order", () => {
    addWorkspace(SERVER, "/dev/opencoder");
    addWorkspace(SERVER, "/dev/hermes");
    expect(readWorkspaces(SERVER)).toEqual(["/dev/opencoder", "/dev/hermes"]);
  });

  it("dedupes re-additions (moves to the end)", () => {
    addWorkspace(SERVER, "/dev/opencoder");
    addWorkspace(SERVER, "/dev/hermes");
    addWorkspace(SERVER, "/dev/opencoder");
    expect(readWorkspaces(SERVER)).toEqual(["/dev/hermes", "/dev/opencoder"]);
  });

  it("keeps servers isolated", () => {
    addWorkspace(SERVER, "/dev/opencoder");
    expect(readWorkspaces("srv-other")).toEqual([]);
  });

  it("removes a workspace from the list", () => {
    addWorkspace(SERVER, "/dev/opencoder");
    addWorkspace(SERVER, "/dev/hermes");
    removeWorkspace(SERVER, "/dev/opencoder");
    expect(readWorkspaces(SERVER)).toEqual(["/dev/hermes"]);
  });

  it("tolerates malformed storage", () => {
    localStorage.setItem("oc-workspaces:" + SERVER, "{not json");
    expect(readWorkspaces(SERVER)).toEqual([]);
    localStorage.setItem("oc-workspaces:" + SERVER, JSON.stringify([42, "/dev/a", ""]));
    expect(readWorkspaces(SERVER)).toEqual(["/dev/a"]);
  });
});
