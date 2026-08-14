// L1 tests for the per-server default workspace memory (feat(default-workspace)):
// read/set round-trips, clear, malformed storage tolerance and the
// workspace-history probe (default set OR recents present).

import { beforeEach, describe, expect, it } from "vitest";
import {
  hasWorkspaceHistory,
  readDefaultWorkspace,
  setDefaultWorkspace,
} from "./defaultWorkspace.js";

const SERVER = "srv-dw";

beforeEach(() => {
  localStorage.clear();
});

describe("defaultWorkspace", () => {
  it("reads null when nothing was set", () => {
    expect(readDefaultWorkspace(SERVER)).toBeNull();
  });

  it("round-trips a set directory", () => {
    setDefaultWorkspace(SERVER, "/dev/opencoder");
    expect(readDefaultWorkspace(SERVER)).toBe("/dev/opencoder");
  });

  it("persists per server (ids do not leak)", () => {
    setDefaultWorkspace(SERVER, "/dev/a");
    expect(readDefaultWorkspace("srv-other")).toBeNull();
  });

  it("clears with null", () => {
    setDefaultWorkspace(SERVER, "/dev/opencoder");
    setDefaultWorkspace(SERVER, null);
    expect(readDefaultWorkspace(SERVER)).toBeNull();
  });

  it("tolerates malformed storage", () => {
    localStorage.setItem("oc-default-workspace:" + SERVER, "{not json");
    expect(readDefaultWorkspace(SERVER)).toBeNull();
    localStorage.setItem("oc-default-workspace:" + SERVER, JSON.stringify(42));
    expect(readDefaultWorkspace(SERVER)).toBeNull();
  });

  it("hasWorkspaceHistory is true when the default is set", () => {
    setDefaultWorkspace(SERVER, "/dev/opencoder");
    expect(hasWorkspaceHistory(SERVER)).toBe(true);
  });

  it("hasWorkspaceHistory is true when recents exist", () => {
    localStorage.setItem("oc-recent-projects:" + SERVER, JSON.stringify(["/dev/opencoder"]));
    expect(hasWorkspaceHistory(SERVER)).toBe(true);
  });

  it("hasWorkspaceHistory is false for a fresh server", () => {
    expect(hasWorkspaceHistory(SERVER)).toBe(false);
  });
});
