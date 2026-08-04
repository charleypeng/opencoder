// File viewer with editor-style tabs (TASK-M4-03): renders the open file
// tabs of the per-server viewer store with an active-tab content area.
// The active tab's content is fetched from GET /file/content once and
// cached per (server, directory, path) in a module-level map, so
// re-activating a tab (or switching Main views, which unmounts the
// viewer) never refetches. The directory scopes the cache to the project
// context the payload was fetched from.
// Content branches: Shiki-highlighted read-only text (language derived
// from the extension, plain escaped fallback on failure), images (base64
// data URL from mimeType + encoding or a pass-through `data:` content),
// unified diffs / patches (text/x-diff mime, the `diff` field, `patch`
// hunks, or a `diff ` / `--- ` content prefix) rendered as colored lines
// (additions green, removals red, hunk/meta headers faint), and a
// "Binary file" note for other binary payloads. The `fullscreen` prop
// reserves the M7 mobile fullscreen page and is a no-op on desktop.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createFileService, type FileContent } from "../../services/file.js";
import { closeTab, setActive, viewer } from "../../stores/viewer.js";
import { getActiveDirectory } from "../../stores/project.js";
import { highlightCode } from "../messages/markdown/highlighter.js";
import { escapeHtml } from "../messages/markdown/markdown.js";

export interface FileViewerProps {
  /** The server whose open tabs are shown. */
  serverId: string;
  /** Reserved for the M7 mobile fullscreen page; desktop renders inline. */
  fullscreen?: boolean;
}

/** (server, directory, path) -> fetched content; module-level so
 *  re-mounting the viewer (Main view switches) keeps tabs' content
 *  without refetching. Entries are evicted when their tab closes. */
const contentCache = new Map<string, FileContent>();

function cacheKey(serverId: string, directory: string | undefined, path: string): string {
  return `${serverId}\u0000${directory ?? ""}\u0000${path}`;
}

function basename(path: string): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}

// --- text highlighting -----------------------------------------------------

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  diff: "diff",
};

/** Shiki language for a file path's extension; "" = plain text fallback. */
function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext] ?? "";
}

function ViewerCode(props: { code: string; lang: string }) {
  let ref: HTMLDivElement | undefined;
  // Highlight async and inject the Shiki HTML; failures render the code
  // as a plain escaped block (mirrors the markdown fence hydration).
  createEffect(() => {
    const el = ref;
    const code = props.code;
    const lang = props.lang;
    if (el === undefined) return;
    void highlightCode(code, lang)
      .then((html) => {
        if (ref === el) el.innerHTML = html;
      })
      .catch(() => {
        if (ref === el) el.innerHTML = `<pre><code>${escapeHtml(code)}</code></pre>`;
      });
  });
  return <div ref={ref} data-testid="viewer-code" class="min-h-full p-3 text-sm" />;
}

// --- diff / patch rendering ------------------------------------------------

type DiffRow = { kind: "ctx" | "add" | "del" | "hunk" | "meta"; text: string };

/** Classifies one unified-diff line by its prefix (no diff library). */
function rowKindOf(line: string): DiffRow["kind"] {
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  if (line.startsWith("---") || line.startsWith("+++")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (
    /^(diff --git|index |new file|deleted file|rename |copy |similarity |dissimilarity |\\)/.test(
      line,
    )
  ) {
    return "meta";
  }
  return "ctx";
}

function diffRowsOf(content: FileContent): DiffRow[] {
  // Structured patch: rebuild the unified headers from the file names and
  // the hunk counts.
  if (content.patch !== undefined && Array.isArray(content.patch.hunks)) {
    const rows: DiffRow[] = [];
    rows.push({ kind: "meta", text: `--- ${content.patch.oldFileName}` });
    rows.push({ kind: "meta", text: `+++ ${content.patch.newFileName}` });
    for (const hunk of content.patch.hunks) {
      rows.push({
        kind: "hunk",
        text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      });
      for (const line of hunk.lines) rows.push({ kind: rowKindOf(line), text: line });
    }
    return rows;
  }
  const text = content.diff !== undefined ? content.diff : (content.content ?? "");
  return text.split("\n").map((line) => ({ kind: rowKindOf(line), text: line }));
}

/** The payload is a unified diff/patch: `diff` field, `patch` hunks,
 *  a diff mime type, or a diff-looking content prefix. */
function isDiffContent(content: FileContent): boolean {
  if (content.diff !== undefined) return true;
  if (content.patch !== undefined && Array.isArray(content.patch.hunks)) return true;
  const mime = content.mimeType ?? "";
  if (mime === "text/x-diff" || mime === "text/x-patch" || mime === "application/x-patch") {
    return true;
  }
  return /^(?:diff |--- )/.test(content.content ?? "");
}

const diffRowClass: Record<DiffRow["kind"], string> = {
  add: "bg-success/15 text-success",
  del: "bg-danger/15 text-danger",
  hunk: "bg-bg-sunken text-fg-faint",
  meta: "bg-bg-sunken text-fg-faint",
  ctx: "text-fg-secondary",
};

function DiffView(props: { rows: DiffRow[] }) {
  return (
    <pre data-testid="viewer-diff" class="min-h-full font-code text-xs leading-relaxed">
      <For each={props.rows}>
        {(row) => (
          <div
            data-kind={row.kind}
            data-testid="viewer-diff-row"
            class={`whitespace-pre-wrap break-words px-3 ${diffRowClass[row.kind]}`}
          >
            {row.text}
          </div>
        )}
      </For>
    </pre>
  );
}

// --- content branches ------------------------------------------------------

function isImageContent(content: FileContent): boolean {
  const mime = content.mimeType ?? "";
  if (mime.startsWith("image/")) return true;
  return (content.content ?? "").startsWith("data:image/");
}

function imageSrc(content: FileContent): string {
  const raw = content.content ?? "";
  if (raw.startsWith("data:")) return raw;
  return `data:${content.mimeType ?? "application/octet-stream"};base64,${raw}`;
}

function ContentView(props: { content: FileContent; path: string }) {
  const content = () => props.content;
  return (
    <Show
      when={isImageContent(content())}
      fallback={
        <Show
          when={isDiffContent(content())}
          fallback={
            <Show
              when={content().type !== "binary"}
              fallback={
                <p data-testid="viewer-binary" class="px-4 py-4 text-sm text-fg-secondary">
                  Binary file — preview not available.
                </p>
              }
            >
              <Show
                when={(content().content ?? "") !== ""}
                fallback={
                  <p data-testid="viewer-empty-file" class="px-4 py-4 text-sm text-fg-secondary">
                    Empty file
                  </p>
                }
              >
                <ViewerCode code={content().content ?? ""} lang={langFromPath(props.path)} />
              </Show>
            </Show>
          }
        >
          <DiffView rows={diffRowsOf(content())} />
        </Show>
      }
    >
      <div class="flex min-h-full items-start justify-start p-4">
        <img
          data-testid="viewer-image"
          src={imageSrc(content())}
          alt={basename(props.path)}
          class="max-h-full max-w-full object-contain"
        />
      </div>
    </Show>
  );
}

// --- viewer ----------------------------------------------------------------

const FileViewer: Component<FileViewerProps> = (props) => {
  const state = createMemo(() => viewer[props.serverId]);
  const tabs = createMemo(() => state()?.tabs ?? []);
  const activePath = createMemo(() => state()?.activePath ?? null);
  const [loadingPath, setLoadingPath] = createSignal<string | null>(null);
  const [loadError, setLoadError] = createSignal<{ path: string; error: ApiError } | null>(null);
  // Guards stale async fetches: a newer activation (or a retry) drops any
  // in-flight result for an older one.
  let fetchSeq = 0;

  async function loadContent(
    serverId: string,
    directory: string | undefined,
    path: string,
    seq: number,
  ): Promise<void> {
    try {
      const content = await createFileService(getApiClient()).content(path);
      if (seq !== fetchSeq) return;
      // Only successful payloads enter the cache; a missing body keeps the
      // tab fetchable on its next activation. A closed tab's in-flight
      // fetch never (re-)adds an entry — closing evicts the content.
      if (content !== undefined && viewer[serverId]?.tabs.some((tab) => tab.path === path)) {
        contentCache.set(cacheKey(serverId, directory, path), content);
      }
      setLoadError(null);
      setLoadingPath(null);
    } catch (err) {
      if (seq !== fetchSeq) return;
      setLoadError({ path, error: ApiError.fromUnknown(err) });
      setLoadingPath(null);
    }
  }

  // Fetch on activation (and on server switch); cached tabs render
  // immediately without a request. The directory is captured up front so
  // a payload is always cached under the context it was fetched from.
  createEffect(() => {
    const serverId = props.serverId;
    const directory = getActiveDirectory();
    const path = activePath();
    if (path === null) return;
    if (contentCache.has(cacheKey(serverId, directory, path))) return;
    const seq = ++fetchSeq;
    setLoadingPath(path);
    void loadContent(serverId, directory, path, seq);
  });

  // Reactive view state for the active tab. The content cache is a plain
  // Map, so this memo re-evaluates on the fetch signal transitions instead:
  // a resolved fetch clears loading (a real change) and the freshly cached
  // content is picked up here. Switching tabs re-runs it via activePath.
  const viewState = createMemo(() => {
    const path = activePath();
    if (path === null) return null;
    const cachedContent = contentCache.get(cacheKey(props.serverId, getActiveDirectory(), path));
    if (cachedContent !== undefined) return { kind: "ready" as const, content: cachedContent };
    const err = loadError();
    if (err !== null && err.path === path) return { kind: "error" as const, error: err.error };
    if (loadingPath() === path) return { kind: "loading" as const };
    return null;
  });
  // Narrowed derives for the render branches (reactive via viewState).
  const viewError = createMemo(() => {
    const v = viewState();
    return v !== null && v.kind === "error" ? v.error : null;
  });
  const readyContent = createMemo(() => {
    const v = viewState();
    return v !== null && v.kind === "ready" ? v.content : null;
  });

  function retry(): void {
    const serverId = props.serverId;
    const directory = getActiveDirectory();
    const path = activePath();
    if (path === null) return;
    const seq = ++fetchSeq;
    setLoadError(null);
    setLoadingPath(path);
    void loadContent(serverId, directory, path, seq);
  }

  // Evicts the tab's cached content together with the tab itself, keeping
  // the module cache from growing with closed files.
  function handleCloseTab(serverId: string, path: string): void {
    contentCache.delete(cacheKey(serverId, getActiveDirectory(), path));
    closeTab(serverId, path);
  }

  return (
    <div data-testid="file-viewer" class="flex h-full min-h-0 flex-col">
      <Show
        when={tabs().length > 0}
        fallback={
          <div
            data-testid="viewer-empty"
            class="flex flex-1 flex-col items-center justify-center gap-1 p-4"
          >
            <p class="text-sm text-fg-secondary">No file open</p>
            <p class="text-xs text-fg-faint">Open a file from the Files panel.</p>
          </div>
        }
      >
        <div
          role="tablist"
          aria-label="Open files"
          class="flex shrink-0 gap-1 overflow-x-auto border-b border-bg-sunken px-2 py-1.5"
        >
          <For each={tabs()}>
            {(tab) => {
              const active = () => activePath() === tab.path;
              return (
                <div
                  class={`flex shrink-0 items-center rounded-md border ${
                    active()
                      ? "border-accent bg-accent-soft"
                      : "border-transparent text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <button
                    type="button"
                    role="tab"
                    data-testid={`viewer-tab-${tab.path}`}
                    aria-selected={active() ? "true" : "false"}
                    title={tab.path}
                    class="max-w-48 truncate px-2.5 py-1 text-xs outline-none"
                    onClick={() => setActive(props.serverId, tab.path)}
                  >
                    {tab.name}
                  </button>
                  <button
                    type="button"
                    data-testid={`viewer-tab-close-${tab.path}`}
                    aria-label={`Close ${tab.name}`}
                    class="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-xs text-fg-faint hover:bg-bg-sunken hover:text-fg-primary"
                    onClick={() => handleCloseTab(props.serverId, tab.path)}
                  >
                    ×
                  </button>
                </div>
              );
            }}
          </For>
        </div>
        <div class="min-h-0 flex-1 overflow-auto">
          <Show when={viewState()?.kind === "loading"}>
            <p data-testid="viewer-loading" class="px-4 py-4 text-sm text-fg-secondary">
              Loading file…
            </p>
          </Show>
          <Show when={viewError() !== null}>
            <div class="space-y-2 p-4">
              <ErrorBanner error={viewError()} onDismiss={() => setLoadError(null)} />
              <button
                type="button"
                data-testid="viewer-retry"
                class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
                onClick={retry}
              >
                Retry
              </button>
            </div>
          </Show>
          <Show when={readyContent() !== null && activePath() !== null}>
            <ContentView content={readyContent() as FileContent} path={activePath() as string} />
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default FileViewer;
