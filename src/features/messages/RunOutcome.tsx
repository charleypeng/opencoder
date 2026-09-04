import { createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import type { SnapshotFileDiff } from "../../services/vcs.js";
import type { Part } from "../../stores/messages.js";
import { useT } from "../../i18n/index.js";
import DiffFileGroup, { type DiffFileEntry } from "../vcs/DiffFileGroup.js";
import { type DiffMode } from "../vcs/diffLines.js";
import { deriveRunOutcome } from "./activity/agentRun.js";

export interface RunOutcomeProps {
  parts: Array<Part | undefined>;
  diffs?: SnapshotFileDiff[];
  messageID: string;
  onViewDiff?: (messageID: string) => void;
  /** Opens the run's diff in the workspace review tool. */
  onViewDiffInTools?: (messageID: string) => void;
}

const RunOutcome: Component<RunOutcomeProps> = (props) => {
  const t = useT();
  const [filesExpanded, setFilesExpanded] = createSignal(false);
  const [commandsExpanded, setCommandsExpanded] = createSignal(false);
  const [expandedFolds, setExpandedFolds] = createSignal<Set<string>>(new Set());
  const outcome = createMemo(() => deriveRunOutcome(props.parts, props.diffs));
  const visible = createMemo(() => outcome().files.length > 0 || outcome().commands.length > 0);
  const fileDiffs = createMemo<DiffFileEntry[]>(() => {
    if ((props.diffs?.length ?? 0) > 0) return props.diffs as DiffFileEntry[];
    return outcome().files.map((file) => ({
      file: file.path,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    }));
  });
  const viewDiff = () => props.onViewDiffInTools ?? props.onViewDiff;

  function toggleFold(key: string): void {
    setExpandedFolds((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Show when={visible()}>
      <div data-testid="run-outcome" class="mt-3 border-t border-bg-sunken/80 pt-2 text-xs">
        <Show when={outcome().files.length > 0}>
          <div>
            <div class="flex min-w-0 items-center gap-1">
              <button
                type="button"
                data-testid="run-files-toggle"
                aria-expanded={filesExpanded()}
                class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-fg-secondary outline-none hover:bg-bg-sunken/50 focus:bg-accent-soft"
                onClick={() => setFilesExpanded((value) => !value)}
              >
                <span
                  aria-hidden="true"
                  class={`inline-block shrink-0 text-fg-faint transition-transform ${filesExpanded() ? "rotate-90" : ""}`}
                >
                  ▸
                </span>
                <span class="font-medium text-fg-secondary">
                  {t("messages:runChangedFiles", { count: outcome().files.length })}
                </span>
                <Show when={outcome().additions > 0}>
                  <span class="font-code text-success">+{outcome().additions}</span>
                </Show>
                <Show when={outcome().deletions > 0}>
                  <span class="font-code text-danger">−{outcome().deletions}</span>
                </Show>
              </button>
              <Show when={viewDiff() !== undefined}>
                <button
                  type="button"
                  data-testid="run-view-diff"
                  class="shrink-0 rounded-md px-2 py-1 text-fg-faint outline-none hover:bg-bg-sunken/50 hover:text-fg-primary focus:bg-accent-soft"
                  onClick={() => viewDiff()?.(props.messageID)}
                >
                  {t("messages:viewDiff")}
                </button>
              </Show>
            </div>
            <Show when={filesExpanded()}>
              <div
                data-testid="run-files"
                class="mt-1 overflow-hidden rounded-md border border-bg-sunken"
              >
                <For each={fileDiffs()}>
                  {(file) => (
                    <DiffFileGroup
                      entry={file}
                      mode={"unified" satisfies DiffMode}
                      expanded={expandedFolds}
                      toggleFold={toggleFold}
                    />
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={outcome().commands.length > 0}>
          <div>
            <button
              type="button"
              data-testid="run-commands-toggle"
              aria-expanded={commandsExpanded()}
              class="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-fg-secondary outline-none hover:bg-bg-sunken/50 focus:bg-accent-soft"
              onClick={() => setCommandsExpanded((value) => !value)}
            >
              <span
                aria-hidden="true"
                class={`inline-block shrink-0 text-fg-faint transition-transform ${commandsExpanded() ? "rotate-90" : ""}`}
              >
                ▸
              </span>
              <span class="font-medium text-fg-secondary">
                {t("messages:runCommands", { count: outcome().commands.length })}
              </span>
            </button>
            <Show when={commandsExpanded()}>
              <ul data-testid="run-commands" class="space-y-1 py-1 pl-6 pr-2">
                <For each={outcome().commands}>
                  {(command) => (
                    <li class="flex min-w-0 gap-2 font-code text-fg-secondary">
                      <span aria-hidden="true" class="shrink-0 text-success">
                        $
                      </span>
                      <span class="min-w-0 truncate">{command}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default RunOutcome;
