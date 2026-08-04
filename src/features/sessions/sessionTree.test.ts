// L1 tests for the session tree helpers (TASK-M6-07): childrenOf grouping,
// topLevelRoots root selection — including the carry-over fix where a deep
// search match under a matched ancestor must NOT duplicate as a root — and
// buildSessionTree nesting with depth.

import { describe, expect, it } from "vitest";
import type { Session } from "../../services/session";
import { buildSessionTree, childrenOf, topLevelRoots } from "./sessionTree";

function session(id: string, parentID?: string): Session {
  return {
    id,
    slug: id,
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: id,
    version: "1.18.11",
    time: { created: 1, updated: 1 },
    ...(parentID !== undefined ? { parentID } : {}),
  } as Session;
}

/** Flattens a tree into (id, depth) pairs in render order. */
function flatten(nodes: ReturnType<typeof buildSessionTree>): [string, number][] {
  const out: [string, number][] = [];
  for (const node of nodes) {
    out.push([node.session.id, node.depth]);
    out.push(...flatten(node.children));
  }
  return out;
}

describe("childrenOf", () => {
  it("groups sessions by parentID in input order", () => {
    const map = childrenOf([session("a"), session("c", "b"), session("b"), session("d", "b")]);
    expect([...map.keys()].sort()).toEqual(["b"]);
    expect(map.get("b")?.map((s) => s.id)).toEqual(["c", "d"]);
  });

  it("ignores sessions without a parent", () => {
    expect(childrenOf([session("a"), session("b")]).size).toBe(0);
  });
});

describe("topLevelRoots", () => {
  it("keeps only chain-top sessions when everything matches", () => {
    const all = [session("a"), session("b", "a"), session("c")];
    // b's parent a is matched, so b renders inside a's subtree, not alone.
    expect(topLevelRoots(all, all).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("treats a child whose parent is missing from the store as a root", () => {
    const all = [session("child", "missing")];
    expect(topLevelRoots(all, all).map((s) => s.id)).toEqual(["child"]);
  });

  it("does not duplicate a deep match under a matched ancestor (M6-03 fix)", () => {
    // Grandparent AND grandchild match the search, the intermediate parent
    // does not: the grandchild must NOT also stand alone as a root.
    const gp = session("gp");
    const parent = session("parent", "gp");
    const grand = session("grand", "parent");
    const all = [gp, parent, grand];
    const roots = topLevelRoots([gp, grand], all);
    expect(roots.map((s) => s.id)).toEqual(["gp"]);
  });

  it("lets a child stand alone when only it matches", () => {
    const all = [session("parent"), session("child", "parent")];
    expect(topLevelRoots([all[1]], all).map((s) => s.id)).toEqual(["child"]);
  });

  it("walks multiple levels up to find a matched ancestor", () => {
    const a = session("a");
    const b = session("b", "a");
    const c = session("c", "b");
    const d = session("d", "c");
    const all = [a, b, c, d];
    // A deep match alone stands on its own (nothing above it matches).
    expect(topLevelRoots([d], all).map((s) => s.id)).toEqual(["d"]);
    // With b matched, d renders inside b's subtree instead of alone.
    expect(topLevelRoots([b, d], all).map((s) => s.id)).toEqual(["b"]);
  });

  it("does not hang on a parentID cycle", () => {
    const x = session("x", "y");
    const y = session("y", "x");
    // The cycle walks back to x (matched), so x is not a root — the point
    // is that the walk terminates.
    expect(topLevelRoots([x], [x, y])).toEqual([]);
  });
});

describe("buildSessionTree", () => {
  it("builds a multi-level tree with depths and child order", () => {
    const a = session("a");
    const b = session("b", "a");
    const c = session("c", "b");
    const d = session("d", "a");
    const tree = buildSessionTree([a, b, c, d], [a]);
    expect(flatten(tree)).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 1],
    ]);
  });

  it("keeps siblings in store order", () => {
    const a = session("a");
    const tree = buildSessionTree([a, session("c2", "a"), session("c1", "a")], [a]);
    expect(flatten(tree).map(([id]) => id)).toEqual(["a", "c2", "c1"]);
  });

  it("pulls the whole subtree along even for unmatched intermediate parents", () => {
    const gp = session("gp");
    const parent = session("parent", "gp");
    const grand = session("grand", "parent");
    // Search matches gp only; the unmatched parent still renders under it.
    const tree = buildSessionTree([gp, parent, grand], [gp]);
    expect(flatten(tree)).toEqual([
      ["gp", 0],
      ["parent", 1],
      ["grand", 2],
    ]);
  });

  it("builds roots independently (matched child alone becomes a single-row tree)", () => {
    const all = [session("parent"), session("child", "parent")];
    const tree = buildSessionTree(all, topLevelRoots([all[1]], all));
    expect(flatten(tree)).toEqual([["child", 0]]);
  });

  it("does not hang on a synthetic parentID cycle", () => {
    const x = session("x", "y");
    const y = session("y", "x");
    // The cycle is cut by the seen set: x renders with y as its only child.
    const tree = buildSessionTree([x, y], [x]);
    expect(flatten(tree)).toEqual([
      ["x", 0],
      ["y", 1],
    ]);
  });
});
