// L1 tests for the workspace tree builders (sidebar nav redesign): grouping
// by directory, parentID filtering, empty-folder completion from projects,
// sorting, uncategorized handling and duplicate-basename disambiguation.

import { describe, expect, it } from "vitest";
import type { Session } from "../../services/session.js";
import type { Project } from "../../services/project.js";
import { buildWorkspaceTree, basename } from "./workspaceTreeUtils.js";

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    slug: id,
    projectID: "prj",
    directory: "/a",
    title: `title-${id}`,
    version: "1",
    time: { created: 1, updated: 1 },
    ...overrides,
  } as Session;
}

function project(id: string, worktree: string, overrides: Partial<Project> = {}): Project {
  return { id, worktree, time: { created: 1, updated: 1 }, sandboxes: [], ...overrides } as Project;
}

describe("basename", () => {
  it("strips the path prefix and keeps the last segment", () => {
    expect(basename("/Volumes/Doc/utm")).toBe("utm");
    expect(basename("/a/b/c")).toBe("c");
  });

  it("handles the root and trailing slashes", () => {
    expect(basename("/")).toBe("/");
    expect(basename("/a/")).toBe("a");
  });
});

describe("buildWorkspaceTree", () => {
  it("groups root sessions by directory and sorts newest-first", () => {
    const old = session("s1", { directory: "/x", time: { created: 1, updated: 100 } });
    const fresh = session("s2", { directory: "/x", time: { created: 1, updated: 200 } });
    const tree = buildWorkspaceTree([old, fresh], []);
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0].directory).toBe("/x");
    expect(tree.folders[0].sessions.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(tree.folders[0].recentMs).toBe(200);
    expect(tree.uncategorized).toEqual([]);
  });

  it("excludes subagent sessions (parentID set) from the tree", () => {
    const parent = session("p1", { directory: "/x" });
    const child = session("c1", { directory: "/x", parentID: "p1" });
    const tree = buildWorkspaceTree([parent, child], []);
    expect(tree.folders[0].sessions.map((s) => s.id)).toEqual(["p1"]);
  });

  it("completes empty folders from projects without sessions", () => {
    const withSession = session("s1", { directory: "/has-session" });
    const tree = buildWorkspaceTree(
      [withSession],
      [project("prj-empty", "/empty-dir", { name: "empty" })],
    );
    expect(tree.folders.map((f) => f.directory)).toEqual(["/has-session", "/empty-dir"]);
    expect(tree.folders[1].sessions).toEqual([]);
    expect(tree.folders[1].name).toBe("empty");
  });

  it("sorts folders by recency (active directories first)", () => {
    const hot = session("s1", { directory: "/hot", time: { created: 1, updated: 900 } });
    const cold = session("s2", { directory: "/cold", time: { created: 1, updated: 100 } });
    const tree = buildWorkspaceTree([hot, cold], []);
    expect(tree.folders.map((f) => f.directory)).toEqual(["/hot", "/cold"]);
  });

  it("keeps sessions without a directory in uncategorized", () => {
    const orphan = session("o1", { directory: undefined as unknown as string });
    const tree = buildWorkspaceTree([orphan], []);
    expect(tree.folders).toEqual([]);
    expect(tree.uncategorized.map((s) => s.id)).toEqual(["o1"]);
  });

  it("disambiguates duplicate basenames with the full path", () => {
    const tree = buildWorkspaceTree(
      [session("a1", { directory: "/proj-a/blog" }), session("b1", { directory: "/proj-b/blog" })],
      [],
    );
    const names = tree.folders.map((f) => f.name);
    expect(names).toContain("blog");
    expect(names).toContain("/proj-b/blog");
  });

  it("prefers project.name over the basename", () => {
    const tree = buildWorkspaceTree([], [project("p1", "/dev/opencoder", { name: "opencoder" })]);
    expect(tree.folders[0].name).toBe("opencoder");
  });
});
