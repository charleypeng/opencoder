// Workspace diff view (TASK-M4-08): renders GET /vcs/diff (VcsFileDiff[] —
// per-file unified patches for the whole working tree) through the shared
// DiffFileGroup renderer, with the same unified/split toggle and folding.
// The fetch runs on mount and on every VCS store version bump (a
// `vcs.branch.updated` event or an apply-refresh changed the working tree),
// stale-guarded like the session diff view.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createVcsService, type VcsFileDiff } from "../../services/vcs.js";
import { vcs } from "../../stores/vcs.js";
import DiffFileGroup, { type DiffFileEntry } from "./DiffFileGroup.js";
import { type DiffMode } from "./diffLines.js";

export interface WorkspaceDiffProps {
  /** The server whose working-tree diff is shown. */
  serverId: string;
}

type DiffState =
  | { kind: "loading" }
  | { kind: "error"; error: ApiError }
  | { kind: "ready"; diffs: VcsFileDiff[] };

const WorkspaceDiff: Component<WorkspaceDiffProps> = (props) => {
  const [mode, setMode] = createSignal<DiffMode>("unified");
  const [state, setState] = createSignal<DiffState>({ kind: "loading" });
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  let fetchSeq = 0;
  let seenVersion = -1;

  async function fetchDiff(seq: number) {
    try {
      const payload = await createVcsService(getApiClient()).diff();
      if (seq !== fetchSeq) return;
      setState({ kind: "ready", diffs: payload });
    } catch (err) {
      if (seq !== fetchSeq) return;
      setState({ kind: "error", error: ApiError.fromUnknown(err) });
    }
  }

  // Fetch on mount and on VCS store version bumps (branch events / apply
  // refreshes); a version bump for the same server refetches silently.
  createEffect(() => {
    const version = vcs[props.serverId]?.version ?? 0;
    if (version === seenVersion) return;
    seenVersion = version;
    const seq = ++fetchSeq;
    if (seq === 1) setState({ kind: "loading" });
    void fetchDiff(seq);
  });

  function retry(): void {
    const seq = ++fetchSeq;
    setState({ kind: "loading" });
    void fetchDiff(seq);
  }

  function toggleFold(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const loading = () => state().kind === "loading";
  const viewError = createMemo(() =>
    state().kind === "error" ? (state() as { kind: "error"; error: ApiError }).error : null,
  );
  const readyDiffs = createMemo(() =>
    state().kind === "ready" ? (state() as { kind: "ready"; diffs: VcsFileDiff[] }).diffs : null,
  );

  return (
    <div data-testid="workspace-diff" class="flex h-full min-h-0 flex-col">
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
            when={(readyDiffs() as VcsFileDiff[]).length > 0}
            fallback={
              <div data-testid="diff-empty" class="py-8 text-center">
                <p class="text-sm text-fg-secondary">No changes in this diff</p>
              </div>
            }
          >
            <div class="flex min-w-0 flex-col divide-y divide-bg-sunken">
              <For each={readyDiffs() as VcsFileDiff[]}>
                {(entry) => (
                  <DiffFileGroup
                    entry={entry as DiffFileEntry}
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

export default WorkspaceDiff;
