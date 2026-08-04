// Glob tool card (TASK-M3-01): search results — the pattern with a file
// count badge and the matched paths as a scrollable mono list.

import { Show } from "solid-js";
import { inputString, outputLines } from "./shared.js";
import type { ToolCard } from "./shared.js";

const GlobCard: ToolCard = (props) => {
  const pattern = () => inputString(props.part.state.input, ["pattern", "glob"]);
  const files = () => outputLines(props.part);

  return (
    <div data-testid="tool-list" class="space-y-1">
      <div class="flex items-center justify-between gap-2">
        <span class="truncate font-code text-xs text-fg-secondary">{pattern() ?? "Glob"}</span>
        <span class="shrink-0 rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
          {files().length} file{files().length === 1 ? "" : "s"}
        </span>
      </div>
      <Show when={files().length > 0}>
        <pre class="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-sm bg-bg-sunken px-2 py-1.5 font-code text-xs leading-relaxed text-fg-secondary">
          {files().join("\n")}
        </pre>
      </Show>
    </div>
  );
};

export default GlobCard;
