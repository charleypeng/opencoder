// File tree panel (TASK-M4-02): the sidebar's Files view. Renders the
// per-server workspace tree from the files store with lazy directory
// expansion (a dir without loaded children fetches GET /file?path= and
// grafts the subtree in), file-type icons, git status dots (added green /
// modified amber / deleted red), and `ignored` entries grayed + italic.
// `file.watcher.updated` / `file.edited` events bump the store version and
// the panel refetches tree + statuses on the change (the fetch is the
// source of truth for the delta). Rows open files through `onOpenFile`
// (wired by the M4-03 viewer); the right-click menu (TASK-M8-03: the shared
// ContextMenu) offers copy path, "Reference in chat" (inserts `@path` into
// the composer through `onReference`, wired by the shell to the composer
// prefill store — the clipboard fallback copies `@path` until a hook is
// provided) and Open.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import ContextMenu from "../../components/ContextMenu.js";
import type { MenuItem } from "../../components/ContextMenu.js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createFileService } from "../../services/file.js";
import { applyStatuses, collapse, expand, files, findNode, setTree } from "../../stores/files.js";
import type { TreeNode } from "../../stores/files.js";
import { useT } from "../../i18n/index.js";

export interface FileTreeProps {
  /** The server whose workspace is shown. */
  serverId: string;
  /** Explicit working directory to browse (GET /file?directory=). When
   *  omitted the server's default workspace is shown. The sidebar's
   *  workspace ⋯ menu "View folder" passes the picked directory here. */
  directory?: string;
  /** Mobile file-browser variant (TASK-M7-09): single-level navigation
   *  with a breadcrumb back bar and full-row touch targets; the desktop
   *  context menu is not attached (long-press menus are deferred to the
   *  M8 menu task). */
  variant?: "desktop" | "mobile";
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
  added: "vcs:statusAdded",
  modified: "vcs:statusModified",
  deleted: "vcs:statusDeleted",
};

function StatusDot(props: { status: string | undefined }) {
  const t = useT();
  const cls = () => (props.status !== undefined ? statusDotClass[props.status] : undefined);
  return (
    <Show when={cls() !== undefined}>
      <span
        data-testid="file-status-dot"
        data-status={props.status}
        title={props.status !== undefined ? t(statusTitle[props.status]) : undefined}
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

// --- panel ------------------------------------------------------------------

const FileTree: Component<FileTreeProps> = (props) => {
  const t = useT();
  const isMobile = () => props.variant === "mobile";
  const state = createMemo(() => files[props.serverId]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);
  const [menu, setMenu] = createSignal<{ node: TreeNode; x: number; y: number } | null>(null);
  const [copiedKind, setCopiedKind] = createSignal<"path" | "reference" | null>(null);
  // Mobile current-directory navigation: "" = the workspace root; the
  // breadcrumb bar jumps to any ancestor (TASK-M7-09).
  const [currentPath, setCurrentPath] = createSignal("");
  const [dirLoading, setDirLoading] = createSignal(false);

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
        // GET /file requires `path` (openapi: required query). The root
        // listing is the empty relative path — omitting it makes real
        // opencode servers answer 400 BadRequest "Missing key at [\"path\"]".
        createFileService(getApiClient()).tree("", props.directory),
        // The status request must target the SAME directory being browsed
        // (workspace ⋯ "View folder" passes an explicit directory). Without
        // it the client injects the global active directory, which may be a
        // different workspace — the server then answers for that other
        // directory and the sidebar shows its status (or errors) instead of
        // the folder the user is actually looking at.
        createFileService(getApiClient()).status(props.directory),
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

  // Refetch on mount, on every store version bump (watcher events) and
  // whenever the requested directory changes (workspace ⋯ "View folder").
  let lastSeenVersion = -1;
  let lastDirectory: string | undefined;
  createEffect(() => {
    const version = state()?.version ?? 0;
    const directory = props.directory;
    if (version === lastSeenVersion && directory === lastDirectory) return;
    lastSeenVersion = version;
    lastDirectory = directory;
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

  // --- mobile navigation (TASK-M7-09) -------------------------------------

  /** Children of the current mobile directory (the workspace root for "").
   *  While the dir's subtree fetch is in flight the children are still
   *  undefined, so the rows stay empty and the loading row shows. */
  const mobileChildren = createMemo(() => {
    const tree = state()?.tree ?? [];
    if (currentPath() === "") return tree;
    return findNode(tree, currentPath())?.children ?? [];
  });

  /** Descends into a directory: marks it expanded (so a watcher refetch's
   *  refill keeps its subtree grafted), switches the current path and
   *  fetches the subtree when it is not loaded yet. */
  async function navigateInto(path: string): Promise<void> {
    const node = findNode(state()?.tree ?? [], path);
    if (node?.type !== "directory") return;
    expand(props.serverId, path);
    setCurrentPath(path);
    if (node.children !== undefined) return;
    setDirLoading(true);
    try {
      // A failed subtree load leaves the dir empty; fall back to the
      // workspace root (always loaded) so the user is not stranded on a
      // dead directory under the error banner.
      if (!(await loadChildren(path))) setCurrentPath("");
    } finally {
      setDirLoading(false);
    }
  }

  /** Jumps to a breadcrumb ancestor ("" = the workspace root). */
  function navigateTo(path: string): void {
    if (path === currentPath()) return;
    setCurrentPath(path);
  }

  /** Breadcrumb trail of the current directory: root + each path segment,
   *  the last one being the current (non-interactive) location. */
  const breadcrumbs = createMemo(() => {
    const crumbs: { label: string; path: string }[] = [{ label: t("files:workspace"), path: "" }];
    let acc = "";
    for (const segment of currentPath()
      .split("/")
      .filter((s) => s !== "")) {
      acc = acc === "" ? segment : `${acc}/${segment}`;
      crumbs.push({ label: segment, path: acc });
    }
    return crumbs;
  });

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
   * Resolves true when the subtree landed (or a newer fetch of the same
   * path owns the outcome), false when this fetch definitively failed and
   * the dir reverted to unloaded.
   */
  async function loadChildren(path: string): Promise<boolean> {
    const seq = (expansionSeq.get(path) ?? 0) + 1;
    expansionSeq.set(path, seq);
    try {
      // The subtree request must target the SAME directory the tree is
      // browsing (props.directory, e.g. a workspace picked via "View
      // folder"). Without it the client injects the global active
      // directory, which may differ from the browsed workspace — the
      // server then can't resolve the relative subtree path and answers
      // with an error, leaving the folder with no children (Bug: subtree
      // would not expand).
      const nodes = await createFileService(getApiClient()).tree(path, props.directory);
      if (expansionSeq.get(path) !== seq) return true;
      setTree(props.serverId, path, nodes);
      refillExpanded();
      return true;
    } catch (err) {
      if (expansionSeq.get(path) !== seq) return true;
      // Revert the chevron and surface the failure; the row click retries.
      collapse(props.serverId, path);
      setError(ApiError.fromUnknown(err));
      return false;
    }
  }

  function onRowClick(node: TreeNode): void {
    if (node.type === "directory") {
      if (isMobile()) void navigateInto(node.path);
      else void toggleDir(node);
    } else props.onOpenFile?.(node.path);
  }

  function onRowContextMenu(node: TreeNode, event: MouseEvent): void {
    event.preventDefault();
    setMenu({ node, x: event.clientX, y: event.clientY });
  }

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

  /** Right-click menu items (TASK-M8-03): copy path and reference keep the
   *  menu open to show the "✓ Copied" feedback (keepOpen), Open closes. */
  const menuItems = createMemo<MenuItem[]>(() => {
    const target = menu();
    if (target === null) return [];
    const node = target.node;
    return [
      {
        id: "copy",
        label: copiedKind() === "path" ? t("files:copiedPath") : t("files:copyPath"),
        keepOpen: true,
        onSelect: () => void copyPath(node),
      },
      {
        id: "reference",
        label: copiedKind() === "reference" ? t("files:copiedReference") : t("files:reference"),
        keepOpen: props.onReference === undefined,
        onSelect: () => void referencePath(node),
      },
      {
        id: "open",
        label: t("files:open"),
        disabled: node.type !== "file" || props.onOpenFile === undefined,
        onSelect: () => {
          if (node.type === "file") props.onOpenFile?.(node.path);
        },
      },
    ];
  });

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

  /** Rows to render: mobile renders the current directory's children at a
   *  flat depth, desktop renders the expanded visible tree. */
  const rows = createMemo(() =>
    isMobile() ? mobileChildren().map((node) => ({ node, depth: 0 })) : visibleRows(),
  );

  const isEmpty = createMemo(() => {
    if (loading() || error() !== null) return false;
    if (isMobile()) return rows().length === 0 && !dirLoading();
    return (state()?.tree.length ?? 0) === 0;
  });

  const emptyTitle = createMemo(() =>
    isMobile() && currentPath() !== "" ? t("files:emptyFolder") : t("files:noFiles"),
  );

  return (
    <div
      data-testid="file-tree"
      data-mobile={isMobile() ? "true" : "false"}
      class="flex h-full min-h-0 flex-col"
    >
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
            {t("common:retry")}
          </button>
        </div>
      </Show>
      {/* Mobile breadcrumb back bar (TASK-M7-09): each ancestor segment
          jumps back to that directory; the current one is a plain label. */}
      <Show when={isMobile()}>
        <nav
          data-testid="file-breadcrumb-bar"
          aria-label={t("files:currentFolder")}
          class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-bg-sunken px-2 py-1.5"
        >
          <For each={breadcrumbs()}>
            {(crumb, index) => {
              const last = () => index() === breadcrumbs().length - 1;
              return (
                <Show
                  when={!last()}
                  fallback={
                    <span
                      data-testid={`file-breadcrumb-${crumb.path || "root"}`}
                      data-current="true"
                      class="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-fg-primary"
                    >
                      {crumb.label}
                    </span>
                  }
                >
                  <button
                    type="button"
                    data-testid={`file-breadcrumb-${crumb.path || "root"}`}
                    class="shrink-0 rounded-md px-2 py-1 text-sm text-fg-secondary outline-none active:bg-accent-soft"
                    onClick={() => navigateTo(crumb.path)}
                  >
                    {crumb.label} ›
                  </button>
                </Show>
              );
            }}
          </For>
        </nav>
      </Show>
      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <Show when={isMobile() && dirLoading()}>
          <p data-testid="file-tree-dir-loading" class="px-3 py-3 text-sm text-fg-secondary">
            {t("files:loadingFiles")}
          </p>
        </Show>
        <For each={rows()}>
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
                class={`group flex w-full cursor-pointer items-center gap-1.5 pr-3 outline-none ${
                  isMobile()
                    ? "min-h-11 px-3 py-2"
                    : "py-1 hover:bg-accent-soft focus:bg-accent-soft"
                } ${node.ignored ? "text-fg-faint" : "text-fg-primary"}`}
                style={isMobile() ? undefined : { "padding-left": `${row.depth * 14 + 8}px` }}
                onClick={() => onRowClick(node)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(node);
                  }
                }}
                onContextMenu={(event) => {
                  if (!isMobile()) onRowContextMenu(node, event);
                }}
              >
                <Show when={!isMobile()}>
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
            <p class="text-sm text-fg-secondary">{emptyTitle()}</p>
            <p class="mt-1 text-xs text-fg-faint">
              {isMobile() && currentPath() !== ""
                ? t("files:emptyFolderHint")
                : t("files:workspaceEmptyHint")}
            </p>
          </div>
        </Show>
      </div>

      {/* Right-click menu (TASK-M8-03): the shared ContextMenu at the
          cursor. Mobile never opens it (no context-menu handler is
          attached). */}
      <Show when={!isMobile() && menu() !== null}>
        <ContextMenu
          testId="file-context"
          label={t("files:fileActions")}
          x={menu()!.x}
          y={menu()!.y}
          items={menuItems()}
          onClose={() => setMenu(null)}
        />
      </Show>
    </div>
  );
};

export default FileTree;
