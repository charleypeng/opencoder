// Grep tool card (TASK-M3-01): search results — the pattern with a match
// count badge and the `path:line: text` matches as a scrollable mono list
// (match highlighting can ride on Shiki later).

import { Show } from "solid-js";
import { inputString, outputLines } from "./shared.js";
import type { ToolCard } from "./shared.js";

const GrepCard: ToolCard = (props) => {
  const pattern = () => inputString(props.part.state.input, ["pattern"]);
  const matches = () => outputLines(props.part);

  return (
    <div data-testid="tool-list" class="space-y-1">
      <div class="flex items-center justify-between gap-2">
        <span class="truncate font-code text-xs text-fg-secondary">{pattern() ?? "Grep"}</span>
        <span class="shrink-0 rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
          {matches().length} match{matches().length === 1 ? "" : "es"}
        </span>
      </div>
      <Show when={matches().length > 0}>
        <pre class="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-sm bg-bg-sunken px-2 py-1.5 font-code text-xs leading-relaxed text-fg-secondary">
          {matches().join("\n")}
        </pre>
      </Show>
    </div>
  );
};

export default GrepCard;
