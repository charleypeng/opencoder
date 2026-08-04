// File tree panel (TASK-M4-02): the sidebar's Files view. Renders the
// per-server workspace tree from the files store with lazy directory
// expansion (a dir without loaded children fetches GET /file?path= and
// grafts the subtree in), file-type icons, git status dots (added green /
// modified amber / deleted red), and `ignored` entries grayed + italic.
// `file.watcher.updated` / `file.edited` events bump the store version and
// the panel refetches tree + statuses on the change (the fetch is the
// source of truth for the delta). Rows open files through `onOpenFile`
// (wired by the M4-03 viewer); the right-click menu offers copy path,
// "Reference in chat" (copies `@path` to the clipboard until a prompt
// insert hook lands with the M8 command palette) and Open.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createFileService } from "../../services/file.js";
import { applyStatuses, collapse, expand, files, setTree } from "../../stores/files.js";
import type { TreeNode } from "../../stores/files.js";

export interface FileTreeProps {
  /** The server whose workspace is shown. */
  serverId: string;
  /** Opens a file in the viewer (wired by M4-03); dirs expand in-tree. */
  onOpenFile?: (path: string) => void;
  /** Inserts a `@path` reference into the composer; defaults to copying it
   *  to the clipboard until an insert hook exists. */
  onReference?: (path: string) => void;
}

// --- file-type icons -------------------------------------------------------
// Minimal stroke glyphs: a folder and a document with a per-family mark;
// unknown extensions fall back to the plain document.

function FileTypeIcon(props: { node: TreeNode }) {
  const folder = () => props.node.type === "directory";
  const ext = () => props.node.name.split(".").pop()?.toLowerCase() ?? "";
  const mark = () => {
    if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext())) return "code";
    if (["json", "toml", "yaml", "yml"].includes(ext())) return "braces";
    if (["md", "markdown", "txt"].includes(ext())) return "lines";
    if (["rs", "go", "py", "rb"].includes(ext())) return "cross";
    if (["css", "scss", "less", "html", "svelte", "vue"].includes(ext())) return "hash";
    if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext())) return "image";
    return "file";
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`h-4 w-4 shrink-0 ${folder() ? "text-fg-secondary" : "text-fg-faint"}`}
      aria-hidden="true"
    >
      <Show
        when={folder()}
        fallback={
          <>
            <path d="M6 3h8l4 4v14H6z" />
            <Show when={mark() === "code"}>
              <path d="M9.5 13l-1.8 1.8 1.8 1.8M14.5 13l1.8 1.8-1.8 1.8" />
            </Show>
            <Show when={mark() === "braces"}>
              <path d="M9.8 12.8l-1.4 1.4 1.4 1.4M14.2 12.8l1.4 1.4-1.4 1.4" />
            </Show>
            <Show when={mark() === "lines"}>
              <path d="M9 13.5h6M9 15.8h4" />
            </Show>
            <Show when={mark() === "cross"}>
              <path d="M10.5 13.2l3 3m0-3l-3 3" />
            </Show>
            <Show when={mark() === "hash"}>
              <path d="M9.2 16.5l1.2-4M13.6 16.5l1.2-4M9.6 13.4h5M8.8 15.4h5.2" />
            </Show>
            <Show when={mark() === "image"}>
              <circle cx="10.4" cy="10.6" r="1.3" />
              <path d="M8.5 16.5l3.2-3.2 2.6 2.6 1.7-1.7 1.5 1.5" />
            </Show>
          </>
        }
      >
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </Show>
    </svg>
  );
}

// --- status dot ------------------------------------------------------------

const statusDotClass: Record<string, string> = {
  added: "bg-success",
  modified: "bg-warning",
  deleted: "bg-danger",
};

const statusTitle: Record<string, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
};

function StatusDot(props: { status: string | undefined }) {
  const cls = () => (props.status !== undefined ? statusDotClass[props.status] : undefined);
  return (
    <Show when={cls() !== undefined}>
      <span
        data-testid="file-status-dot"
        data-status={props.status}
        title={props.status !== undefined ? statusTitle[props.status] : undefined}
        class={`inline-block h-2 w-2 shrink-0 rounded-full ${cls()}`}
      />
    </Show>
  );
}

// --- clipboard -------------------------------------------------------------

/** Copies via the async Clipboard API with a legacy execCommand fallback
 *  (mirrors MessageActions / tools shared copy). */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

const menuItemClass =
  "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left text-sm outline-none " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 disabled:cursor-not-allowed " +
  "disabled:opacity-50 hover:bg-accent-soft focus:bg-accent-soft";

// --- panel ------------------------------------------------------------------

const FileTree: Component<FileTreeProps> = (props) => {
  const state = createMemo(() => files[props.serverId]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);
  const [menu, setMenu] = createSignal<{ node: TreeNode; x: number; y: number } | null>(null);
  const [copiedKind, setCopiedKind] = createSignal<"path" | "reference" | null>(null);

  // Guards stale async work across refetches and rapid expand toggles. Root
  // loads share one sequence (a newer root refetch supersedes older ones);
  // expansion fetches are tracked per path so a sibling expansion never
  // drops another dir's graft.
  let fetchSeq = 0;
  const expansionSeq = new Map<string, number>();

  async function loadRoot(): Promise<void> {
    const seq = ++fetchSeq;
    setLoading(true);
    setError(null);
    try {
      const [treeNodes, statusEntries] = await Promise.all([
        createFileService(getApiClient()).tree(),
        createFileService(getApiClient()).status(),
      ]);
      if (seq !== fetchSeq) return;
      setTree(props.serverId, undefined, treeNodes);
      applyStatuses(props.serverId, statusEntries);
      // The root replace drops grafted subtrees; refill every expanded dir
      // that lost its children (deeper levels refill as each one lands).
      refillExpanded();
    } catch (err) {
      if (seq !== fetchSeq) return;
      setError(ApiError.fromUnknown(err));
    } finally {
      if (seq === fetchSeq) setLoading(false);
    }
  }

  // Refetch on mount and on every store version bump (watcher events).
  let lastSeenVersion = -1;
  createEffect(() => {
    const version = state()?.version ?? 0;
    if (version === lastSeenVersion) return;
    lastSeenVersion = version;
    void loadRoot();
  });

  async function toggleDir(node: TreeNode): Promise<void> {
    if (state()?.expanded[node.path]) {
      collapse(props.serverId, node.path);
      return;
    }
    expand(props.serverId, node.path);
    if (node.children !== undefined) return; // loaded already
    await loadChildren(node.path);
  }

  /** Paths of expanded directories whose children are not loaded yet. */
  function missingExpanded(): string[] {
    const tree = state()?.tree ?? [];
    const expanded = state()?.expanded ?? {};
    const out: string[] = [];
    const walk = (nodes: TreeNode[]): void => {
      for (const node of nodes) {
        if (
          node.type === "directory" &&
          expanded[node.path] === true &&
          node.children === undefined
        ) {
          out.push(node.path);
        } else if (node.children !== undefined) {
          walk(node.children);
        }
      }
    };
    walk(tree);
    return out;
  }

  /** Starts subtree fetches for every expanded dir missing its children
   *  (after a root replace); each graft refills deeper levels in turn. */
  function refillExpanded(): void {
    for (const path of missingExpanded()) void loadChildren(path);
  }

  /**
   * Fetches one directory's subtree and grafts it. Guarded per path: only a
   * newer fetch of the SAME path (rapid re-toggle, refill after a refetch)
   * drops an in-flight result — sibling expansions never invalidate each
   * other, so every expanded dir keeps the children it fetched.
   */
  async function loadChildren(path: string): Promise<void> {
    const seq = (expansionSeq.get(path) ?? 0) + 1;
    expansionSeq.set(path, seq);
    try {
      const nodes = await createFileService(getApiClient()).tree(path);
      if (expansionSeq.get(path) !== seq) return;
      setTree(props.serverId, path, nodes);
      refillExpanded();
    } catch (err) {
      if (expansionSeq.get(path) !== seq) return;
      // Revert the chevron and surface the failure; the row click retries.
      collapse(props.serverId, path);
      setError(ApiError.fromUnknown(err));
    }
  }

  function onRowClick(node: TreeNode): void {
    if (node.type === "directory") void toggleDir(node);
    else props.onOpenFile?.(node.path);
  }

  function onRowContextMenu(node: TreeNode, event: MouseEvent): void {
    event.preventDefault();
    setMenu({ node, x: event.clientX, y: event.clientY });
  }

  // Esc closes the hand-rolled context popover (mirrors MessageActions).
  createEffect(() => {
    if (menu() === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function copyPath(node: TreeNode): Promise<void> {
    if (await copyToClipboard(node.path)) setCopiedKind("path");
  }

  async function referencePath(node: TreeNode): Promise<void> {
    if (props.onReference !== undefined) {
      props.onReference(node.path);
      return;
    }
    // No prompt-insert hook yet: copy the `@path` token so the composer
    // (or any other surface) can paste it; wired to the composer in M8.
    if (await copyToClipboard(`@${node.path}`)) setCopiedKind("reference");
  }

  // Flat list of visible rows (expanded dirs walk their children).
  const visibleRows = createMemo(() => {
    const tree = state()?.tree ?? [];
    const expanded = state()?.expanded ?? {};
    const out: { node: TreeNode; depth: number }[] = [];
    const walk = (nodes: TreeNode[], depth: number): void => {
      for (const node of nodes) {
        out.push({ node, depth });
        if (
          node.type === "directory" &&
          node.children !== undefined &&
          expanded[node.path] === true
        ) {
          walk(node.children, depth + 1);
        }
      }
    };
    walk(tree, 0);
    return out;
  });

  const isEmpty = createMemo(
    () => !loading() && error() === null && (state()?.tree.length ?? 0) === 0,
  );

  return (
    <div data-testid="file-tree" class="flex h-full min-h-0 flex-col">
      <Show when={loading() && (state()?.tree.length ?? 0) === 0 && error() === null}>
        <p data-testid="file-tree-loading" class="px-3 py-4 text-sm text-fg-secondary">
          Loading files…
        </p>
      </Show>
      <Show when={error()}>
        <div class="space-y-2 px-3 pt-3">
          <ErrorBanner error={error()} onDismiss={() => setError(null)} />
          <button
            type="button"
            data-testid="file-tree-retry"
            class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
            onClick={() => void loadRoot()}
          >
            Retry
          </button>
        </div>
      </Show>
      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <For each={visibleRows()}>
          {(row) => {
            const node = row.node;
            const status = () => state()?.statuses[node.path];
            const expandedFlag = () => state()?.expanded[node.path] === true;
            const isDir = node.type === "directory";
            return (
              <div
                role="button"
                tabIndex={0}
                data-testid={`file-row-${node.path}`}
                data-type={node.type}
                data-ignored={node.ignored ? "true" : "false"}
                title={node.path}
                class={`group flex w-full cursor-pointer items-center gap-1.5 py-1 pr-3 outline-none hover:bg-accent-soft focus:bg-accent-soft ${
                  node.ignored ? "text-fg-faint" : "text-fg-primary"
                }`}
                style={{ "padding-left": `${row.depth * 14 + 8}px` }}
                onClick={() => onRowClick(node)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(node);
                  }
                }}
                onContextMenu={(event) => onRowContextMenu(node, event)}
              >
                <Show when={isDir}>
                  <span
                    data-testid="file-chevron"
                    data-expanded={expandedFlag() ? "true" : "false"}
                    class={`w-3 shrink-0 text-center text-xs transition-transform ${
                      expandedFlag() ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>
                </Show>
                <Show when={!isDir}>
                  <span class="w-3 shrink-0" />
                </Show>
                <FileTypeIcon node={node} />
                <span
                  data-testid="file-name"
                  class={`min-w-0 flex-1 truncate text-sm ${
                    node.ignored ? "italic opacity-60" : ""
                  }`}
                >
                  {node.name}
                </span>
                <StatusDot status={status()} />
              </div>
            );
          }}
        </For>
        <Show when={isEmpty()}>
          <div data-testid="file-tree-empty" class="px-3 py-6 text-center">
            <p class="text-sm text-fg-secondary">No files</p>
            <p class="mt-1 text-xs text-fg-faint">The workspace is empty.</p>
          </div>
        </Show>
      </div>

      {/* Right-click popover at the cursor (same pattern as MessageActions). */}
      <Show when={menu() !== null}>
        <div
          data-testid="file-context-backdrop"
          class="fixed inset-0 z-40"
          onContextMenu={(event) => event.preventDefault()}
          onClick={() => setMenu(null)}
        />
        <div
          data-testid="file-context-menu"
          class="glass fixed z-50 min-w-44 p-1"
          style={{
            left: `${Math.min(menu()!.x, window.innerWidth - 200)}px`,
            top: `${Math.min(menu()!.y, window.innerHeight - 200)}px`,
          }}
        >
          <button
            type="button"
            data-testid="file-context-copy"
            class={menuItemClass}
            onClick={() => void copyPath(menu()!.node)}
          >
            {copiedKind() === "path" ? "✓ Copied" : "Copy path"}
          </button>
          <button
            type="button"
            data-testid="file-context-reference"
            class={menuItemClass}
            onClick={() => {
              const node = menu()!.node;
              // The clipboard fallback keeps the menu open to show the
              // ✓ feedback; a real insert hook closes it.
              if (props.onReference !== undefined) setMenu(null);
              void referencePath(node);
            }}
          >
            {copiedKind() === "reference" ? "✓ Copied @path" : "Reference in chat"}
          </button>
          <button
            type="button"
            data-testid="file-context-open"
            class={menuItemClass}
            disabled={menu()!.node.type !== "file" || props.onOpenFile === undefined}
            onClick={() => {
              const node = menu()!.node;
              setMenu(null);
              if (node.type === "file") props.onOpenFile?.(node.path);
            }}
          >
            Open
          </button>
        </div>
      </Show>
    </div>
  );
};

export default FileTree;
