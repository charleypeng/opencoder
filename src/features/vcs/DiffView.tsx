// Session diff view (TASK-M4-07): renders GET /session/{id}/diff payloads
// (SnapshotFileDiff[] — per-file stats plus optional unified patch text)
// as per-file groups. Unified mode shows line-numbered rows with green/red
// add/del coloring and runs of more than three unchanged lines folded
// behind an expand handle; split mode aligns the old/new sides side by
// side. The fetch runs on mount / session / message id change (stale
// guarded), and the diff store's version counter refetches when a
// `session.diff` event lands while the view is open. Per-file rendering is
// the shared DiffFileGroup component (TASK-M4-08) — the workspace diff
// view reuses it for /vcs/diff payloads. Files without patch content
// render as a stats card with a note.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createVcsService, type SnapshotFileDiff } from "../../services/vcs.js";
import { diffs } from "../../stores/diff.js";
import DiffFileGroup, { type DiffFileEntry } from "./DiffFileGroup.js";
import { type DiffMode } from "./diffLines.js";
import { useT } from "../../i18n/index.js";

export interface DiffViewProps {
  /** The server whose session diff is shown. */
  serverId: string;
  /** The session to render. */
  sessionId: string;
  /** Filters the diff to one message's changes (optional). */
  messageId?: string;
  /** Initial view mode; toggling is internal state (default unified). */
  mode?: DiffMode;
}

export type { DiffMode };

type DiffState =
  | { kind: "loading" }
  | { kind: "error"; error: ApiError }
  | { kind: "ready"; diffs: SnapshotFileDiff[] };

const DiffView: Component<DiffViewProps> = (props) => {
  const t = useT();
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
            {t("common:retry")}
          </button>
        </div>
      </Show>
      <Show when={readyDiffs() !== null}>
        <div class="flex shrink-0 items-center justify-end gap-1 border-b border-bg-sunken px-3 py-1.5">
          <span class="text-xs text-fg-faint">{t("vcs:view")}</span>
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
            {t("vcs:unified")}
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
            {t("vcs:split")}
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <Show
            when={(readyDiffs() as SnapshotFileDiff[]).length > 0}
            fallback={
              <div data-testid="diff-empty" class="py-8 text-center">
                <p class="text-sm text-fg-secondary">{t("vcs:noChangesInDiff")}</p>
              </div>
            }
          >
            <div class="flex min-w-0 flex-col divide-y divide-bg-sunken">
              <For each={readyDiffs() as SnapshotFileDiff[]}>
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

export default DiffView;
