// VCS panel (TASK-M4-08): the workspace's version-control view. Fetches
// GET /vcs (branch) + GET /vcs/status (change list) on mount and on every
// VCS store version bump (a `vcs.branch.updated` event or a manual refresh),
// writing both snapshots back to the store so the status-bar branch chip
// shares the same source. The changes view lists per-file rows (status
// letter chip + path + +N/-M badges); the workspace diff sub-view renders
// GET /vcs/diff through WorkspaceDiff. The apply section takes a pasted
// unified patch, asks for confirmation in a dialog (applying modifies the
// working tree), POSTs it to /vcs/apply and reports the outcome — a
// success clears the textarea and bumps the store version so status and
// diff refetch. Non-git workspaces (no branch) render a graceful empty
// state without the diff or apply sections.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError, errorDetailMessage } from "../../services/errors.js";
import { useT } from "../../i18n/index.js";
import { createVcsService, type VcsFileStatus, type VcsInfo } from "../../services/vcs.js";
import { applyStatus, applyVcs, refresh, vcs } from "../../stores/vcs.js";
import WorkspaceDiff from "./WorkspaceDiff.js";
import DiffFileGroup, { type DiffFileEntry } from "./DiffFileGroup.js";

export interface VcsPanelProps {
  /** The server whose workspace is shown. */
  serverId: string;
}

const statusLetter: Record<string, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
};

const statusChipClass: Record<string, string> = {
  added: "bg-success/15 text-success",
  deleted: "bg-danger/15 text-danger",
  modified: "bg-accent-soft text-accent",
};

const statusTitleKey: Record<string, string> = {
  added: "vcs:statusAdded",
  deleted: "vcs:statusDeleted",
  modified: "vcs:statusModified",
};

function ChangeRow(props: { change: VcsFileStatus; onOpen?: (file: string) => void }) {
  const t = useT();
  return (
    <div
      data-testid="vcs-change"
      data-status={props.change.status}
      class="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-bg-sunken/40"
      onClick={() => props.onOpen?.(props.change.file)}
    >
      <span
        data-testid="vcs-change-chip"
        title={t(statusTitleKey[props.change.status])}
        class={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
          statusChipClass[props.change.status] ?? "bg-bg-sunken text-fg-faint"
        }`}
      >
        {statusLetter[props.change.status] ?? "?"}
      </span>
      <span
        data-testid="vcs-change-file"
        class="min-w-0 flex-1 truncate font-code text-xs"
        title={props.change.file}
      >
        {props.change.file}
      </span>
      <span
        data-testid="vcs-change-stats"
        class="flex shrink-0 items-center gap-1 font-code text-xs tabular-nums"
      >
        <span class="text-success">+{props.change.additions}</span>
        <span class="text-danger">-{props.change.deletions}</span>
      </span>
    </div>
  );
}

const VcsPanel: Component<VcsPanelProps> = (props) => {
  const t = useT();
  const state = createMemo(() => vcs[props.serverId]);
  // "changes" = file list; "diff" = full workspace diff; "file-diff" = one
  // file's patch (opened by clicking a change row).
  const [subView, setSubView] = createSignal<"changes" | "diff" | "file-diff">("changes");
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null);
  const [fileDiff, setFileDiff] = createSignal<DiffFileEntry | null>(null);
  const [fileDiffLoading, setFileDiffLoading] = createSignal(false);
  const [fileDiffError, setFileDiffError] = createSignal<ApiError | null>(null);
  const [error, setError] = createSignal<ApiError | null>(null);
  const [applying, setApplying] = createSignal(false);
  const [applyError, setApplyError] = createSignal<ApiError | null>(null);
  const [applyDone, setApplyDone] = createSignal(false);
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [patchText, setPatchText] = createSignal("");

  let fetchSeq = 0;
  let seenVersion = -1;

  /** Fetches branch info + change list; both snapshots land in the store. */
  async function fetchSnapshot(seq: number) {
    setError(null);
    try {
      const [info, statuses] = await Promise.all([
        createVcsService(getApiClient()).info(),
        createVcsService(getApiClient()).status(),
      ]);
      if (seq !== fetchSeq) return;
      applyVcs(props.serverId, info as VcsInfo);
      applyStatus(props.serverId, statuses);
    } catch (err) {
      if (seq !== fetchSeq) return;
      setError(ApiError.fromUnknown(err));
    }
  }

  // Fetch on mount and on VCS store version bumps (branch events / the
  // refresh button). applyVcs/applyStatus never bump, so snapshots cannot
  // retrigger this effect.
  createEffect(() => {
    const version = state()?.version ?? 0;
    if (version === seenVersion) return;
    seenVersion = version;
    const seq = ++fetchSeq;
    if (seq === 1) setError(null);
    void fetchSnapshot(seq);
  });

  function retry(): void {
    const seq = ++fetchSeq;
    setError(null);
    void fetchSnapshot(seq);
  }

  /** Manual refresh: bump the version; the effect above refetches. */
  function onRefresh(): void {
    refresh(props.serverId);
  }

  /** Fetches the full workspace diff and extracts one file's entry to
   *  show in the per-file diff sub-view (the API has no per-file filter). */
  async function openFileDiff(file: string) {
    setSelectedFile(file);
    setSubView("file-diff");
    setFileDiff(null);
    setFileDiffError(null);
    setFileDiffLoading(true);
    try {
      const diffs = await createVcsService(getApiClient()).diff();
      const entry = diffs.find((d) => d.file === file);
      if (entry !== undefined) {
        setFileDiff(entry as DiffFileEntry);
      } else {
        setFileDiffError(new ApiError(undefined, "not_found", t("vcs:noDiffForFile"), false));
      }
    } catch (err) {
      setFileDiffError(ApiError.fromUnknown(err));
    } finally {
      setFileDiffLoading(false);
    }
  }

  function closeConfirm(): void {
    setConfirmOpen(false);
  }

  /** Applies the pasted patch; success refreshes status and diff. */
  async function runApply(): Promise<void> {
    // Defense-in-depth: the confirm dialog already guards the destructive
    // path; never POST an empty patch.
    if (patchText().trim() === "") return;
    setApplying(true);
    setApplyError(null);
    setApplyDone(false);
    try {
      const result = await createVcsService(getApiClient()).apply(patchText());
      if (!result.applied) {
        setApplyError(new ApiError(undefined, "vcs_apply", t("vcs:serverRejectedPatch"), false));
        return;
      }
      setPatchText("");
      setApplyDone(true);
      refresh(props.serverId);
    } catch (err) {
      setApplyError(ApiError.fromUnknown(err));
    } finally {
      setApplying(false);
      setConfirmOpen(false);
    }
  }

  const isGit = () => state() !== undefined && state()?.branch !== null;
  const clean = () =>
    state() !== undefined && state()?.branch !== null && (state()?.changes.length ?? 0) === 0;

  return (
    <div data-testid="vcs-panel" class="flex h-full min-h-0 flex-col">
      <Show
        when={subView() === "diff" || subView() === "file-diff"}
        fallback={
          <>
            <header class="flex shrink-0 items-center gap-2 border-b border-bg-sunken px-3 py-2">
              <Show when={isGit()}>
                <span
                  data-testid="vcs-branch"
                  title={t("vcs:currentBranch")}
                  class="shrink-0 rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 font-code text-xs text-fg-primary"
                >
                  {state()?.branch ?? ""}
                </span>
              </Show>
              <Show when={isGit()}>
                <span data-testid="vcs-count" class="shrink-0 text-xs text-fg-secondary">
                  {t("vcs:changesCount", { count: state()?.changes.length ?? 0 })}
                </span>
              </Show>
              <div class="min-w-0 flex-1" />
              <Show when={isGit()}>
                <button
                  type="button"
                  data-testid="vcs-diff-button"
                  class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
                  onClick={() => setSubView("diff")}
                >
                  {t("vcs:workspaceDiff")}
                </button>
                <button
                  type="button"
                  data-testid="vcs-refresh"
                  class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
                  onClick={onRefresh}
                >
                  {t("common:refresh")}
                </button>
              </Show>
            </header>

            <div class="min-h-0 flex-1 overflow-y-auto">
              <Show when={state() === undefined && error() === null}>
                <p data-testid="vcs-loading" class="px-3 py-4 text-sm text-fg-secondary">
                  {t("vcs:loadingState")}
                </p>
              </Show>
              <Show when={error()}>
                <div class="space-y-2 p-3">
                  <ErrorBanner error={error()} onDismiss={() => setError(null)} />
                  <button
                    type="button"
                    data-testid="vcs-retry"
                    class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
                    onClick={retry}
                  >
                    {t("common:retry")}
                  </button>
                </div>
              </Show>
              <Show when={state() !== undefined && state()?.branch === null && error() === null}>
                <div data-testid="vcs-non-git" class="px-3 py-8 text-center">
                  <p class="text-sm text-fg-secondary">{t("vcs:notGit")}</p>
                  <p class="mt-1 text-xs text-fg-faint">{t("vcs:notGitHint")}</p>
                </div>
              </Show>
              <Show when={isGit() && error() === null}>
                <Show
                  when={!clean()}
                  fallback={
                    <div data-testid="vcs-changes-empty" class="px-3 py-8 text-center">
                      <p class="text-sm text-fg-secondary">{t("vcs:workingTreeClean")}</p>
                      <p class="mt-1 text-xs text-fg-faint">{t("vcs:noChangesHint")}</p>
                    </div>
                  }
                >
                  <div class="flex flex-col divide-y divide-bg-sunken/60">
                    <For each={state()?.changes ?? []}>
                      {(change) => (
                        <ChangeRow change={change} onOpen={(file) => void openFileDiff(file)} />
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>

            {/* Patch apply (git workspaces only; pasting + confirm flow). */}
            <Show when={isGit() && error() === null}>
              <section
                data-testid="vcs-apply"
                class="shrink-0 space-y-2 border-t border-bg-sunken p-3"
              >
                <h3 class="text-xs font-semibold text-fg-secondary">{t("vcs:applyPatch")}</h3>
                <textarea
                  data-testid="vcs-apply-input"
                  rows={4}
                  spellcheck={false}
                  placeholder={t("vcs:applyPatchHint")}
                  class="w-full resize-y rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 font-code text-xs text-fg-primary outline-none placeholder:text-fg-faint focus:border-accent"
                  value={patchText()}
                  onInput={(event) => {
                    setPatchText(event.currentTarget.value);
                    setApplyDone(false);
                  }}
                />
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="vcs-apply-button"
                    disabled={patchText().trim() === "" || applying()}
                    class="rounded-md bg-accent px-3 py-1 text-xs font-medium text-bg-base outline-none transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => setConfirmOpen(true)}
                  >
                    {applying() ? t("vcs:applying") : t("vcs:apply")}
                  </button>
                  <Show when={applyDone()}>
                    <span data-testid="vcs-apply-success" class="text-xs text-success">
                      {t("vcs:patchApplied")}
                    </span>
                  </Show>
                  <Show when={applyError()}>
                    <span
                      data-testid="vcs-apply-error"
                      role="alert"
                      class="min-w-0 flex-1 text-xs text-danger"
                    >
                      {errorDetailMessage(applyError() as ApiError)}
                    </span>
                  </Show>
                </div>
              </section>
            </Show>
          </>
        }
      >
        {/* Workspace diff sub-view with a back to the change list. */}
        <div class="flex shrink-0 items-center gap-2 border-b border-bg-sunken px-3 py-2">
          <button
            type="button"
            data-testid="vcs-diff-back"
            class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
            onClick={() => setSubView("changes")}
          >
            ← {t("vcs:changes")}
          </button>
          <h3 class="shrink-0 text-sm font-semibold">
            {subView() === "file-diff" ? (selectedFile() ?? "") : t("vcs:workspaceDiff")}
          </h3>
        </div>
        <Show
          when={subView() === "file-diff"}
          fallback={<WorkspaceDiff serverId={props.serverId} />}
        >
          <div class="min-h-0 flex-1 overflow-y-auto">
            <Show when={fileDiffLoading()}>
              <p data-testid="diff-loading" class="px-4 py-4 text-sm text-fg-secondary">
                {t("vcs:loadingState")}
              </p>
            </Show>
            <Show when={fileDiffError() !== null}>
              <div class="space-y-2 p-4">
                <ErrorBanner error={fileDiffError()} onDismiss={() => setFileDiffError(null)} />
              </div>
            </Show>
            <Show when={fileDiff() !== null}>
              <DiffFileGroup
                entry={fileDiff() as DiffFileEntry}
                mode="unified"
                expanded={() => new Set()}
                toggleFold={() => {}}
              />
            </Show>
          </div>
        </Show>
      </Show>

      {/* Apply confirmation (TASK-M4-08): applying modifies the working tree. */}
      <Show when={confirmOpen()}>
        <div
          data-testid="vcs-apply-backdrop"
          class="fixed inset-0 z-40 bg-black/40"
          onClick={closeConfirm}
        />
        <div
          data-testid="vcs-apply-confirm"
          role="dialog"
          aria-modal="true"
          aria-label={t("vcs:confirmApplying")}
          class="glass fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg p-4"
        >
          <h3 class="text-sm font-semibold">{t("vcs:applyThisPatch")}</h3>
          <p class="mt-1 text-xs text-fg-secondary">{t("vcs:applyThisPatchHint")}</p>
          <div class="mt-3 flex justify-end gap-2">
            <button
              type="button"
              data-testid="vcs-apply-cancel"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
              onClick={closeConfirm}
            >
              {t("common:cancel")}
            </button>
            <button
              type="button"
              data-testid="vcs-apply-confirm-btn"
              disabled={applying()}
              class="rounded-md bg-accent px-3 py-1 text-xs font-medium text-bg-base outline-none hover:opacity-90 disabled:opacity-40"
              onClick={() => void runApply()}
            >
              {t("vcs:apply")}
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default VcsPanel;
