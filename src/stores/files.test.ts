// L1 tests for the files store (TASK-M4-02): flat-to-nested tree building
// with directory-first sorting, root/subtree setTree grafting, expand/
// collapse state, status map application, watcher-event version bumps, and
// per-server isolation + reset.

import { afterEach, describe, expect, it } from "vitest";
import type { FileNode, FileStatusEntry } from "../services/file.js";
import {
  applyStatuses,
  applyWatcher,
  buildTree,
  collapse,
  expand,
  files,
  findNode,
  getServerFiles,
  resetServer,
  setTree,
} from "./files.js";

const SERVER = "srv-files";

function node(path: string, type: FileNode["type"], ignored = false): FileNode {
  const segments = path.split("/");
  return {
    name: segments[segments.length - 1],
    path,
    absolute: `/mock/projects/demo/${path}`,
    type,
    ignored,
  };
}

afterEach(() => {
  resetServer(SERVER);
});

describe("buildTree", () => {
  it("builds one level: direct children of the parent only", () => {
    const tree = buildTree([
      node("src/auth/login.ts", "file"),
      node("src", "directory"),
      node("package.json", "file"),
      node("src/auth", "directory"),
      node("src/App.tsx", "file"),
    ]);
    expect(tree.map((n) => n.path)).toEqual(["src", "package.json"]);
    expect(findNode(tree, "src")?.children).toBeUndefined();
  });

  it("builds the level under a parent path", () => {
    const children = buildTree(
      [
        node("src/auth/login.ts", "file"),
        node("src/auth/session.ts", "file"),
        node("src/App.tsx", "file"),
        node("src/auth", "directory"),
      ],
      "src",
    );
    expect(children.map((n) => n.path)).toEqual(["src/auth", "src/App.tsx"]);
    expect(findNode(children, "src/auth")?.children).toBeUndefined();
  });

  it("sorts directories first and names alphabetically (case-insensitive)", () => {
    const tree = buildTree([
      node("zebra.ts", "file"),
      node("apple", "directory"),
      node("Beta.ts", "file"),
      node("node_modules", "directory"),
    ]);
    expect(tree.map((n) => n.path)).toEqual(["apple", "node_modules", "Beta.ts", "zebra.ts"]);
  });

  it("keeps children undefined when no direct children exist (unloaded dirs)", () => {
    const tree = buildTree([node("src", "directory"), node("README.md", "file")]);
    expect(findNode(tree, "src")?.children).toBeUndefined();
  });
});

describe("files store actions", () => {
  it("setTree without path replaces the root tree", () => {
    setTree(SERVER, undefined, [node("a.ts", "file")]);
    expect(files[SERVER].tree.map((n) => n.path)).toEqual(["a.ts"]);

    setTree(SERVER, undefined, [node("b.ts", "file")]);
    expect(files[SERVER].tree.map((n) => n.path)).toEqual(["b.ts"]);
  });

  it("setTree with a path grafts direct children onto the matching directory node", () => {
    setTree(SERVER, undefined, [
      node("src", "directory"),
      node("src/auth", "directory"),
      node("src/auth/login.ts", "file"),
      node("README.md", "file"),
    ]);
    // Descendants stay unloaded until their own expansion.
    expect(findNode(files[SERVER].tree, "src")?.children).toBeUndefined();

    setTree(SERVER, "src", [
      node("src/App.tsx", "file"),
      node("src/auth", "directory"),
      node("src/auth/session.ts", "file"),
    ]);
    const src = findNode(files[SERVER].tree, "src")!;
    expect(src.children?.map((n) => n.path)).toEqual(["src/auth", "src/App.tsx"]);
    expect(findNode(src.children!, "src/auth")?.children).toBeUndefined();
  });

  it("setTree drops expansions for unknown paths and ignores non-arrays", () => {
    setTree(SERVER, undefined, [node("a.ts", "file")]);
    setTree(SERVER, "missing", [node("x.ts", "file")]);
    expect(files[SERVER].tree.map((n) => n.path)).toEqual(["a.ts"]);

    setTree(SERVER, undefined, undefined as unknown as FileNode[]);
    expect(files[SERVER].tree.map((n) => n.path)).toEqual(["a.ts"]);
  });

  it("expand/collapse toggles the expanded map", () => {
    setTree(SERVER, undefined, [node("src", "directory")]);
    expect(files[SERVER].expanded).toEqual({});
    expand(SERVER, "src");
    expect(files[SERVER].expanded["src"]).toBe(true);
    collapse(SERVER, "src");
    expect(files[SERVER].expanded["src"]).toBeUndefined();
  });

  it("applyStatuses maps entries to a path -> status record", () => {
    applyStatuses(SERVER, [
      { path: "src/a.ts", added: 2, removed: 0, status: "modified" },
      { path: "src/b.ts", added: 10, removed: 0, status: "added" },
      { path: "src/c.ts", added: 0, removed: 4, status: "deleted" },
    ]);
    expect(files[SERVER].statuses).toEqual({
      "src/a.ts": "modified",
      "src/b.ts": "added",
      "src/c.ts": "deleted",
    });
    // Wholesale replacement on refetch.
    applyStatuses(SERVER, []);
    expect(files[SERVER].statuses).toEqual({});
  });

  it("applyWatcher bumps the version (refetch trigger) and ignores malformed calls", () => {
    setTree(SERVER, undefined, [node("a.ts", "file")]);
    expect(files[SERVER].version).toBe(0);
    applyWatcher(SERVER, "src/a.ts");
    applyWatcher(SERVER, "src/b.ts");
    expect(files[SERVER].version).toBe(2);
    applyWatcher(SERVER, undefined as unknown as string);
    expect(files[SERVER].version).toBe(2);
    // Tree payloads are not patched locally.
    expect(files[SERVER].tree.map((n) => n.path)).toEqual(["a.ts"]);
  });

  it("keeps servers isolated and resetServer drops the bucket", () => {
    setTree(SERVER, undefined, [node("a.ts", "file")]);
    setTree("srv-other", undefined, [node("b.ts", "file")]);
    applyStatuses(SERVER, [
      { path: "a.ts", added: 0, removed: 0, status: "modified" } as FileStatusEntry,
    ]);
    expect(files[SERVER].tree[0].path).toBe("a.ts");
    expect(files["srv-other"].tree[0].path).toBe("b.ts");
    expect(files[SERVER].statuses).toEqual({ "a.ts": "modified" });

    resetServer(SERVER);
    expect(files[SERVER]).toBeUndefined();
    expect(getServerFiles(SERVER)).toBeUndefined();
    expect(files["srv-other"].tree[0].path).toBe("b.ts");
  });
});
