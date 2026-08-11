// Files store (TASK-M4-02): per-server workspace file tree + git status
// markers, fed by GET /file, GET /file/status and the `file.watcher.updated`
// / `file.edited` SSE events. The /file payload is a FLAT FileNode list, so
// the store builds the tree one level at a time (direct children of a
// parent, directories first, both alphabetical). Directory nodes without a
// `children` array are unloaded: FileTree lazily fetches their subtree via
// tree(path) and grafts it in with setTree. Watcher events carry only a
// changed path (no node shape), so they cannot patch the tree locally —
// they bump `version` and mounted FileTree views refetch tree + statuses
// on the version change.

import { createStore, produce } from "solid-js/store";
import type { FileNode, FileStatusEntry } from "../services/file.js";

/** Tree node: FileNode plus lazily-loaded children (undefined = unloaded). */
export type TreeNode = FileNode & { children?: TreeNode[] };

export interface FileServerState {
  /** Nested workspace tree (root level). */
  tree: TreeNode[];
  /** Dir path -> expanded state (drives the chevron + row visibility). */
  expanded: Record<string, boolean>;
  /** Path -> git status word (added/deleted/modified); absent = clean. */
  statuses: Record<string, FileStatusEntry["status"]>;
  /** Bumped by watcher/edited events; FileTree refetches on change. */
  version: number;
}

export type FilesMap = Record<string, FileServerState>;

const [files, setFiles] = createStore<FilesMap>({});

/** Reactive per-server file state (bucket absent until first fetch). */
export { files };

/** Non-reactive read of one server's file state bucket. */
export function getServerFiles(serverId: string): FileServerState | undefined {
  return files[serverId];
}

// --- tree building ---------------------------------------------------------

/** Splits a path into segments on either separator, dropping empty ones
 *  (root "/"). */
function pathSegments(path: string): string[] {
  return path.split(/[\\/]/).filter((segment) => segment !== "");
}

/** Strips trailing separators. The real server (1.18.11) appends the OS
 *  separator to directory entries (`src/` on POSIX, `src\` on Windows), so
 *  paths are normalized before they enter the tree — otherwise parent
 *  matching (`src/features/` under `src/`) fails and expansion shows nothing.
 */
function normalizePath(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

/** Directories first, then files; both alphabetical (case-insensitive). */
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * Builds ONE level of the tree: the direct children of `parentPath` (root
 * when omitted) present in the flat payload. Descendants are intentionally
 * dropped — deeper directories load lazily via tree(path) on expansion, so
 * a full-list server response and a one-level response behave identically.
 */
export function buildTree(nodes: FileNode[], parentPath?: string): TreeNode[] {
  const parent = normalizePath(parentPath ?? "");
  const out: TreeNode[] = [];
  for (const node of nodes) {
    const path = normalizePath(node.path);
    const segments = pathSegments(path);
    segments.pop();
    if (segments.join("/") === parent) out.push({ ...node, path });
  }
  out.sort(compareNodes);
  return out;
}

/** Depth-first search for a node by path in a (possibly nested) tree. */
export function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children !== undefined) {
      const hit = findNode(node.children, path);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

// --- actions ---------------------------------------------------------------

/**
 * Sets one tree level. Without `path` the workspace root is replaced with
 * the payload's root-level entries; with `path` the direct children of that
 * directory node are replaced (an expansion fetch). An expansion for an
 * unknown path (tree reset in between) is dropped; the next version
 * refetch rebuilds the root.
 */
export function setTree(serverId: string, path: string | undefined, nodes: FileNode[]): void {
  if (!Array.isArray(nodes)) return;
  const children = buildTree(nodes, path);
  setFiles(
    produce((draft) => {
      const server = draft[serverId] ?? { tree: [], expanded: {}, statuses: {}, version: 0 };
      if (path === undefined) {
        server.tree = children;
      } else {
        const target = findNode(server.tree, path);
        if (target !== undefined) target.children = children;
      }
      draft[serverId] = server;
    }),
  );
}

/** Marks a directory expanded (row visibility; FileTree lazily loads it). */
export function expand(serverId: string, path: string): void {
  setFiles(
    produce((draft) => {
      const server = draft[serverId] ?? { tree: [], expanded: {}, statuses: {}, version: 0 };
      server.expanded[path] = true;
      draft[serverId] = server;
    }),
  );
}

/** Marks a directory collapsed (children stay loaded, just hidden). */
export function collapse(serverId: string, path: string): void {
  setFiles(
    produce((draft) => {
      const server = draft[serverId];
      if (server === undefined) return;
      delete server.expanded[path];
      draft[serverId] = server;
    }),
  );
}

/** Replaces the status map wholesale (initial fetch / refetch). */
export function applyStatuses(serverId: string, entries: FileStatusEntry[]): void {
  if (!Array.isArray(entries)) return;
  const statuses: Record<string, FileStatusEntry["status"]> = {};
  for (const entry of entries) {
    if (typeof entry.path === "string" && entry.path !== "") statuses[entry.path] = entry.status;
  }
  setFiles(
    produce((draft) => {
      const server = draft[serverId] ?? { tree: [], expanded: {}, statuses: {}, version: 0 };
      server.statuses = statuses;
      draft[serverId] = server;
    }),
  );
}

/**
 * Applies a `file.watcher.updated` / `file.edited` event. The payload
 * carries only the changed path, so the delta needs a refetch: bump the
 * version and let mounted FileTree views refetch tree + statuses. Servers
 * whose Files view was never opened are left untouched.
 */
export function applyWatcher(serverId: string, file: string): void {
  if (typeof file !== "string") return;
  setFiles(
    produce((draft) => {
      const server = draft[serverId];
      if (server === undefined) return;
      server.version += 1;
      draft[serverId] = server;
    }),
  );
}

/** Clears all file state for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setFiles(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
