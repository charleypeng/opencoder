import { createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import type { SnapshotFileDiff } from "../../services/vcs.js";
import type { Part } from "../../stores/messages.js";
import { useT } from "../../i18n/index.js";
import { deriveRunOutcome } from "./activity/agentRun.js";

export interface RunOutcomeProps {
  parts: Array<Part | undefined>;
  diffs?: SnapshotFileDiff[];
  messageID: string;
  onViewDiff?: (messageID: string) => void;
}

const RunOutcome: Component<RunOutcomeProps> = (props) => {
  const t = useT();
  const [filesExpanded, setFilesExpanded] = createSignal(false);
  const [commandsExpanded, setCommandsExpanded] = createSignal(false);
  const outcome = createMemo(() => deriveRunOutcome(props.parts, props.diffs));
  const visible = createMemo(() => outcome().files.length > 0 || outcome().commands.length > 0);

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
              <Show when={props.onViewDiff !== undefined}>
                <button
                  type="button"
                  data-testid="run-view-diff"
                  class="shrink-0 rounded-md px-2 py-1 text-fg-faint outline-none hover:bg-bg-sunken/50 hover:text-fg-primary focus:bg-accent-soft"
                  onClick={() => props.onViewDiff?.(props.messageID)}
                >
                  {t("messages:viewDiff")}
                </button>
              </Show>
            </div>
            <Show when={filesExpanded()}>
              <ul data-testid="run-files" class="space-y-1 py-1 pl-6 pr-2">
                <For each={outcome().files}>
                  {(file) => (
                    <li class="flex min-w-0 items-center gap-2 font-code text-fg-secondary">
                      <span class="min-w-0 flex-1 truncate">{file.path}</span>
                      <Show when={(file.additions ?? 0) > 0}>
                        <span class="shrink-0 text-success">+{file.additions}</span>
                      </Show>
                      <Show when={(file.deletions ?? 0) > 0}>
                        <span class="shrink-0 text-danger">−{file.deletions}</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
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
