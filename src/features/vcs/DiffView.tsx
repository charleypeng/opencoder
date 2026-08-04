// Session diff view (TASK-M4-07): renders GET /session/{id}/diff payloads
// (SnapshotFileDiff[] — per-file stats plus optional unified patch text)
// as per-file groups. Unified mode shows line-numbered rows with green/red
// add/del coloring and runs of more than three unchanged lines folded
// behind an expand handle; split mode aligns the old/new sides side by
// side. The fetch runs on mount / session / message id change (stale
// guarded), and the diff store's version counter refetches when a
// `session.diff` event lands while the view is open. Files without patch
// content render as a stats card with a note — M4-08's /vcs/diff delivers
// patch content for the working tree.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createVcsService, type SnapshotFileDiff } from "../../services/vcs.js";
import { diffs } from "../../stores/diff.js";
import {
  alignSplit,
  foldGroups,
  parseUnifiedDiff,
  visibleLines,
  type DiffLine,
  type FoldGroup,
  type SplitRow,
} from "./diffLines.js";

export interface DiffViewProps {
  /** The server whose session diff is shown. */
  serverId: string;
  /** The session to render. */
  sessionId: string;
  /** Filters the diff to one message's changes (optional). */
  messageId?: string;
  /** Initial view mode; toggling is internal state (default unified). */
  mode?: "unified" | "split";
}

export type DiffMode = "unified" | "split";

type DiffState =
  | { kind: "loading" }
  | { kind: "error"; error: ApiError }
  | { kind: "ready"; diffs: SnapshotFileDiff[] };

const lineNumberClass = "w-12 shrink-0 select-none text-right pr-3 text-fg-faint tabular-nums";

const rowClass: Record<DiffLine["kind"], string> = {
  add: "bg-success/15 text-success",
  del: "bg-danger/15 text-danger",
  hunk: "bg-bg-sunken text-fg-faint",
  meta: "bg-bg-sunken text-fg-faint",
  ctx: "text-fg-secondary",
};

function UnifiedRow(props: { line: DiffLine }) {
  return (
    <div
      data-testid="diff-row"
      data-kind={props.line.kind}
      class={`flex whitespace-pre-wrap break-words px-3 font-code text-xs leading-relaxed ${rowClass[props.line.kind]}`}
    >
      <span class={lineNumberClass}>{props.line.oldLine ?? ""}</span>
      <span class={lineNumberClass}>{props.line.newLine ?? ""}</span>
      <span class="min-w-0 flex-1">{props.line.text}</span>
    </div>
  );
}

function SplitCell(props: { line: DiffLine | null; side: "old" | "new" }) {
  return (
    <Show
      when={props.line !== null}
      fallback={<div data-testid="diff-split-cell" class="min-h-full bg-bg-sunken/50" />}
    >
      <div
        data-testid="diff-split-cell"
        data-kind={(props.line as DiffLine).kind}
        class={`flex whitespace-pre-wrap break-words px-3 font-code text-xs leading-relaxed ${rowClass[(props.line as DiffLine).kind]}`}
      >
        <span class={lineNumberClass}>
          {props.side === "old"
            ? ((props.line as DiffLine).oldLine ?? "")
            : ((props.line as DiffLine).newLine ?? "")}
        </span>
        <span class="min-w-0 flex-1">{(props.line as DiffLine).text}</span>
      </div>
    </Show>
  );
}

function SplitRow(props: { row: SplitRow }) {
  return (
    <div
      data-testid="diff-split-row"
      data-span={props.row.kind === "span" ? "true" : "false"}
      class={
        props.row.kind === "span"
          ? "flex whitespace-pre-wrap break-words bg-bg-sunken px-3 font-code text-xs leading-relaxed text-fg-faint"
          : "grid grid-cols-2"
      }
    >
      <Show
        when={props.row.kind === "span"}
        fallback={
          <>
            <SplitCell line={props.row.old} side="old" />
            <SplitCell line={props.row.new} side="new" />
          </>
        }
      >
        {props.row.old?.text ?? ""}
      </Show>
    </div>
  );
}

function DiffFile(props: {
  entry: SnapshotFileDiff;
  mode: DiffMode;
  expanded: () => Set<string>;
  toggleFold: (key: string) => void;
}) {
  // Parsed rows; null when the entry carries no patch content (stats only).
  const rows = createMemo(() =>
    props.entry.patch === undefined ? null : parseUnifiedDiff(props.entry.patch),
  );
  const groups = createMemo<FoldGroup[]>(() =>
    rows() === null ? [] : foldGroups(rows() as DiffLine[]),
  );
  const split = createMemo<SplitRow[]>(() =>
    rows() === null ? [] : alignSplit(rows() as DiffLine[]),
  );

  return (
    <section data-testid="diff-file" class="flex min-w-0 flex-col">
      <header
        data-testid="diff-file-header"
        class="flex shrink-0 items-center gap-2 border-b border-bg-sunken bg-bg-elevated px-3 py-1.5"
      >
        <span class="min-w-0 flex-1 truncate font-code text-xs" title={props.entry.file ?? ""}>
          {props.entry.file ?? "Unknown file"}
        </span>
        <span data-testid="diff-file-stats" class="shrink-0 font-code text-xs text-fg-secondary">
          +{props.entry.additions} -{props.entry.deletions}
        </span>
        <Show when={props.entry.status !== undefined}>
          <span
            data-testid="diff-file-status"
            data-status={props.entry.status}
            class={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${
              props.entry.status === "added"
                ? "bg-success/15 text-success"
                : props.entry.status === "deleted"
                  ? "bg-danger/15 text-danger"
                  : "bg-accent-soft text-accent"
            }`}
          >
            {props.entry.status}
          </span>
        </Show>
      </header>
      <Show
        when={rows() !== null}
        fallback={
          <p data-testid="diff-file-no-content" class="px-3 py-3 text-xs text-fg-secondary">
            Content not available for this diff.
          </p>
        }
      >
        <Show
          when={props.mode === "unified"}
          fallback={
            <div data-testid="diff-split" class="min-w-0 flex-1 overflow-x-auto">
              <div class="grid grid-cols-2 min-w-max">
                <For each={split()}>{(row) => <SplitRow row={row} />}</For>
              </div>
            </div>
          }
        >
          <div data-testid="diff-unified" class="min-w-0 flex-1 overflow-x-auto">
            <For each={groups()}>
              {(group) => {
                // Getter: reads expanded() inside the JSX memo, so a fold
                // toggle re-renders this group.
                const collapsed = () => group.key !== null && !props.expanded().has(group.key);
                return (
                  <>
                    <For each={visibleLines(group, !collapsed())}>
                      {(line) => <UnifiedRow line={line} />}
                    </For>
                    <Show when={collapsed()}>
                      <button
                        type="button"
                        data-testid="diff-fold"
                        data-key={group.key ?? ""}
                        class="block w-full px-3 py-1 text-left font-code text-xs text-fg-faint outline-none hover:text-accent"
                        onClick={() => props.toggleFold(group.key as string)}
                      >
                        … {group.foldCount} unchanged lines
                      </button>
                    </Show>
                  </>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}

const DiffView: Component<DiffViewProps> = (props) => {
  // Mode toggle lives here (internal state); the prop seeds the default.
  // eslint-disable-next-line solid/reactivity -- one-time initial value
  const [mode, setMode] = createSignal<DiffMode>(props.mode ?? "unified");
  const [state, setState] = createSignal<DiffState>({ kind: "loading" });
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  // Guards stale async fetches: a newer key (or retry) drops any in-flight
  // result for an older one.
  let fetchSeq = 0;
  // The (server, session, message) key and store version the last fetch was
  // issued for. A version bump for the SAME key refetches silently (no
  // loading flash); a key change reloads from scratch.
  let seenKey = "";
  let seenVersion = -1;

  async function fetchDiff(sessionId: string, messageId: string | undefined, seq: number) {
    try {
      const payload = await createVcsService(getApiClient()).sessionDiff(sessionId, messageId);
      if (seq !== fetchSeq) return;
      setState({ kind: "ready", diffs: payload });
    } catch (err) {
      if (seq !== fetchSeq) return;
      setState({ kind: "error", error: ApiError.fromUnknown(err) });
    }
  }

  // Fetch on key change (server/session/message id) and on `session.diff`
  // version bumps. Reading the store here (tracked) drives both cases.
  createEffect(() => {
    const serverId = props.serverId;
    const sessionId = props.sessionId;
    const messageId = props.messageId;
    const version = diffs[serverId]?.[sessionId]?.version ?? -1;
    const key = `${serverId}\u0000${sessionId}\u0000${messageId ?? ""}`;
    const keyChanged = key !== seenKey;
    const versionChanged = version !== seenVersion;
    if (!keyChanged && !versionChanged) return;
    seenKey = key;
    seenVersion = version;
    const seq = ++fetchSeq;
    if (keyChanged) {
      setExpanded(new Set<string>());
      setState({ kind: "loading" });
    }
    void fetchDiff(sessionId, messageId, seq);
  });

  function retry(): void {
    const seq = ++fetchSeq;
    setState({ kind: "loading" });
    void fetchDiff(props.sessionId, props.messageId, seq);
  }

  function toggleFold(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Narrowed derives for the render branches (reactive via state()).
  const loading = () => state().kind === "loading";
  const viewError = createMemo(() =>
    state().kind === "error" ? (state() as { kind: "error"; error: ApiError }).error : null,
  );
  const readyDiffs = createMemo(() =>
    state().kind === "ready"
      ? (state() as { kind: "ready"; diffs: SnapshotFileDiff[] }).diffs
      : null,
  );

  return (
    <div data-testid="session-diff-view" class="flex h-full min-h-0 flex-col">
      <Show when={loading()}>
        <p data-testid="diff-loading" class="px-4 py-4 text-sm text-fg-secondary">
          Loading diff…
        </p>
      </Show>
      <Show when={viewError() !== null}>
        <div class="space-y-2 p-4">
          <ErrorBanner error={viewError()} onDismiss={() => setState({ kind: "loading" })} />
          <button
            type="button"
            data-testid="diff-retry"
            class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
            onClick={retry}
          >
            Retry
          </button>
        </div>
      </Show>
      <Show when={readyDiffs() !== null}>
        <div class="flex shrink-0 items-center justify-end gap-1 border-b border-bg-sunken px-3 py-1.5">
          <span class="text-xs text-fg-faint">View:</span>
          <button
            type="button"
            data-testid="diff-mode-unified"
            aria-pressed={mode() === "unified" ? "true" : "false"}
            class={`rounded-md px-2.5 py-1 text-xs outline-none transition-colors ${
              mode() === "unified"
                ? "bg-accent-soft text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
            onClick={() => setMode("unified")}
          >
            Unified
          </button>
          <button
            type="button"
            data-testid="diff-mode-split"
            aria-pressed={mode() === "split" ? "true" : "false"}
            class={`rounded-md px-2.5 py-1 text-xs outline-none transition-colors ${
              mode() === "split"
                ? "bg-accent-soft text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
            onClick={() => setMode("split")}
          >
            Split
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <Show
            when={(readyDiffs() as SnapshotFileDiff[]).length > 0}
            fallback={
              <div data-testid="diff-empty" class="py-8 text-center">
                <p class="text-sm text-fg-secondary">No changes in this diff</p>
              </div>
            }
          >
            <div class="flex min-w-0 flex-col divide-y divide-bg-sunken">
              <For each={readyDiffs() as SnapshotFileDiff[]}>
                {(entry) => (
                  <DiffFile
                    entry={entry}
                    mode={mode()}
                    expanded={expanded}
                    toggleFold={toggleFold}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default DiffView;
