// Fallback tool card (TASK-M3-01): raw output text for tool types without
// a dedicated renderer; the input JSON is already covered by the shared
// Input disclosure in ToolPart, so the body only needs the output block.

import { Show } from "solid-js";
import { CopyButton, outputText } from "./shared.js";
import type { ToolCard } from "./shared.js";

const GenericCard: ToolCard = (props) => {
  const output = () => outputText(props.part);

  return (
    <div data-testid="tool-generic" class="space-y-1">
      <Show when={output().length > 0}>
        <div class="flex items-center justify-between gap-2">
          <span class="truncate font-code text-xs text-fg-secondary">Output</span>
          <CopyButton text={output()} />
        </div>
        <pre class="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-sm bg-bg-sunken px-2 py-1.5 font-code text-xs leading-relaxed text-fg-secondary">
          {output()}
        </pre>
      </Show>
    </div>
  );
};

export default GenericCard;
