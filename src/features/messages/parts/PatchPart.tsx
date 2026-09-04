// Patch card (TASK-M3-02): renders a PatchPart as a bordered card with a
// short commit-hash badge, a total file count and one row per patched
// file. Clicking a file row expands the file's diff inline — the diff is
// fetched once per card from GET /session/{id}/diff (message-filtered) and
// rendered with the shared DiffFileGroup (TASK-M4-08) so line coloring and
// context folding match the session diff view. The 1.18.11 schema carries
// no per-file add/del counts (only `hash` + `files`), so no +/- count
// badges are rendered on the rows; the stats come from the diff payload.
//
// IA-13/14/15: the card provides a unified diff summary view with an
// intent description slot. When the data carries an intent string, it is
// shown below the header. The file list uses monospace font and diff-
// convention color hints.

import { createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { useT } from "../../../i18n/index.js";
import { getApiClient } from "../../../services/client.js";
import { ApiError } from "../../../services/errors.js";
import { createVcsService, type SnapshotFileDiff } from "../../../services/vcs.js";
import DiffFileGroup, { type DiffFileEntry } from "../../vcs/DiffFileGroup.js";
import { type DiffMode } from "../../vcs/diffLines.js";

export type PatchPartData = Extract<Part, { type: "patch" }>;

export interface PatchPartProps {
  part: PatchPartData;
  /** IA-15: optional intent description explaining why this patch was made.
   *  When the data carries an intent string, it is displayed; otherwise
   *  the slot is hidden (data does not currently carry intent). */
  intent?: string;
}

type DiffState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: ApiError }
  | { kind: "ready"; diffs: SnapshotFileDiff[] };

function matchesPatchFile(patchFile: string, diffFile: string | undefined): boolean {
  if (diffFile === undefined) return false;
  const normalize = (path: string) => path.replace(/^[ab]\//, "").replace(/\\/g, "/");
  const patchPath = normalize(patchFile);
  const diffPath = normalize(diffFile);
  return (
    patchPath === diffPath ||
    patchPath.endsWith(`/${diffPath}`) ||
    diffPath.endsWith(`/${patchPath}`)
  );
}

const PatchPart: Component<PatchPartProps> = (props) => {
  const t = useT();
  const shortHash = createMemo(() => props.part.hash.slice(0, 7));
  // The file whose diff is expanded; null = all rows collapsed.
  const [expandedFile, setExpandedFile] = createSignal<string | null>(null);
  // Per-card diff payload, fetched once on first expansion (message-
  // filtered, so it only covers this patch's message).
  const [diffState, setDiffState] = createSignal<DiffState>({ kind: "idle" });
  // Context-fold state for DiffFileGroup's unchanged-run handles.
  const [foldExpanded, setFoldExpanded] = createSignal<Set<string>>(new Set());
  // Guards stale fetches after an error retry.
  let fetchSeq = 0;

  function toggleFold(key: string): void {
    setFoldExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Expands/collapses a file row; lazily fetches the card's diff payload
   *  on the first expansion (cached afterwards). */
  function toggleFile(file: string): void {
    if (expandedFile() === file) {
      setExpandedFile(null);
      return;
    }
    setExpandedFile(file);
    if (diffState().kind === "ready" || diffState().kind === "loading") return;
    const seq = ++fetchSeq;
    setDiffState({ kind: "loading" });
    void createVcsService(getApiClient())
      .sessionDiff(props.part.sessionID, props.part.messageID)
      .then((diffs) => {
        if (seq !== fetchSeq) return;
        setDiffState({ kind: "ready", diffs });
      })
      .catch((err) => {
        if (seq !== fetchSeq) return;
        setDiffState({ kind: "error", error: ApiError.fromUnknown(err) });
      });
  }

  /** The expanded file's diff entry (undefined = not in this message's
   *  diff payload). Patch events can carry absolute paths while the diff
   *  endpoint returns workspace-relative paths, so match both forms. */
  const expandedEntry = createMemo<DiffFileEntry | undefined>(() => {
    const file = expandedFile();
    if (file === null || diffState().kind !== "ready") return undefined;
    const entry = (diffState() as { kind: "ready"; diffs: SnapshotFileDiff[] }).diffs.find(
      (candidate) => matchesPatchFile(file, candidate.file),
    );
    return entry === undefined ? undefined : { ...entry, file };
  });

  return (
    <div data-testid="patch-part" class="my-1 overflow-hidden rounded-md bg-bg-sunken/50">
      <div class="flex items-center gap-2 px-2 py-1.5 text-xs">
        <svg
          aria-hidden
          class="h-3.5 w-3.5 shrink-0 text-fg-faint"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M5 3v10M3.5 4.5 5 3l1.5 1.5M11 3v10M12.5 11.5 11 13l-1.5-1.5" />
        </svg>
        <span class="font-code font-medium text-fg-primary">{t("messages:patch")}</span>
        <span
          data-testid="patch-hash"
          class="rounded-sm bg-bg-elevated px-1 py-0.5 font-code text-[10px] text-fg-faint"
        >
          {shortHash()}
        </span>
        <span data-testid="patch-count" class="ml-auto shrink-0 text-fg-faint">
          {t("messages:filesCount", { count: props.part.files.length })}
        </span>
      </div>
      {/* IA-15: intent description slot — visible when the data carries
          an intent string explaining why this patch was made. */}
      <Show when={props.intent !== undefined && props.intent !== ""}>
        <div
          data-testid="patch-intent"
          class="border-t border-bg-sunken px-2 py-1.5 text-xs italic text-fg-secondary"
        >
          {props.intent}
        </div>
      </Show>
      <ul class="border-t border-bg-sunken">
        <For each={props.part.files}>
          {(file) => (
            <li>
              <button
                type="button"
                data-testid="patch-file"
                aria-expanded={expandedFile() === file ? "true" : "false"}
                class="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-fg-secondary outline-none hover:text-fg-primary focus:bg-accent-soft"
                onClick={() => toggleFile(file)}
              >
                <svg
                  aria-hidden
                  class="h-3 w-3 shrink-0 text-fg-faint"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M3 5.5 8 2.8l5 2.7v5l-5 2.7-5-2.7Z" />
                  <path d="M3 5.5l5 2.7 5-2.7M8 8.2v5" />
                </svg>
                {/* IA-13/14: file paths in monospace for diff-style display */}
                <span class="truncate font-code">{file}</span>
                <span
                  aria-hidden
                  class={`ml-auto shrink-0 text-fg-faint transition-transform ${
                    expandedFile() === file ? "rotate-90" : ""
                  }`}
                >
                  ▸
                </span>
              </button>
              <Show when={expandedFile() === file}>
                <div class="border-t border-bg-sunken">
                  <Show
                    when={diffState().kind !== "loading"}
                    fallback={
                      <p
                        data-testid="patch-diff-loading"
                        class="px-3 py-2 text-xs text-fg-secondary"
                      >
                        {t("messages:patchDiffLoading")}
                      </p>
                    }
                  >
                    <Show
                      when={diffState().kind !== "error"}
                      fallback={
                        <p data-testid="patch-diff-error" class="px-3 py-2 text-xs text-danger">
                          {(diffState() as { kind: "error"; error: ApiError }).error.message}
                        </p>
                      }
                    >
                      <Show
                        when={expandedEntry() !== undefined}
                        fallback={
                          <p
                            data-testid="patch-diff-empty"
                            class="px-3 py-2 text-xs text-fg-secondary"
                          >
                            {t("messages:patchDiffEmpty")}
                          </p>
                        }
                      >
                        <DiffFileGroup
                          entry={expandedEntry() as DiffFileEntry}
                          mode={"unified" as DiffMode}
                          expanded={foldExpanded}
                          toggleFold={toggleFold}
                        />
                      </Show>
                    </Show>
                  </Show>
                </div>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
};

export default PatchPart;
