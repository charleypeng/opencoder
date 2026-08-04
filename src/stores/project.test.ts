// L1 tests for the project store (TASK-M2-02): project list replacement,
// active directory setting, per-server reset and the active-directory
// client-injection helper (TASK-M2-03).

import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "../services/project.js";
import {
  applyProjects,
  getActiveDirectory,
  getServerProjectState,
  projects,
  resetServer,
  setCurrent,
} from "./project.js";
import { getActiveServerId, setActiveServer } from "./registry.js";

function project(id: string, worktree: string): Project {
  return {
    id,
    worktree,
    time: { created: 1, updated: 1 },
    sandboxes: [],
  } as Project;
}

afterEach(() => {
  resetServer("srv-prj");
  resetServer("srv-prj-b");
  setActiveServer(null);
});

describe("project store", () => {
  it("starts with an empty bucket", () => {
    expect(getServerProjectState("srv-prj")).toEqual({ projects: [], current: null });
  });

  it("applyProjects replaces the project list", () => {
    applyProjects("srv-prj", [project("p1", "/a"), project("p2", "/b")]);
    expect(projects["srv-prj"].projects.map((p) => p.id)).toEqual(["p1", "p2"]);

    applyProjects("srv-prj", [project("p3", "/c")]);
    expect(projects["srv-prj"].projects.map((p) => p.id)).toEqual(["p3"]);
  });

  it("setCurrent stores the active directory path and clears with null", () => {
    setCurrent("srv-prj", "/mock/projects/opencode-demo");
    expect(projects["srv-prj"].current).toBe("/mock/projects/opencode-demo");
    setCurrent("srv-prj", null);
    expect(projects["srv-prj"].current).toBeNull();
  });

  it("keeps servers independent and resetServer clears only its own bucket", () => {
    applyProjects("srv-prj", [project("p1", "/a")]);
    applyProjects("srv-prj-b", [project("p2", "/b")]);
    resetServer("srv-prj");
    expect(projects["srv-prj"]).toBeUndefined();
    expect(projects["srv-prj-b"].projects[0].id).toBe("p2");
  });

  it("getActiveDirectory reads the active server's current directory", () => {
    expect(getActiveServerId()).toBeNull();
    expect(getActiveDirectory()).toBeUndefined();

    setActiveServer("srv-prj");
    expect(getActiveDirectory()).toBeUndefined();

    setCurrent("srv-prj", "/mock/projects/opencode-demo");
    expect(getActiveDirectory()).toBe("/mock/projects/opencode-demo");

    setCurrent("srv-prj", null);
    expect(getActiveDirectory()).toBeUndefined();
  });
});
