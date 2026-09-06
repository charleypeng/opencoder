// Read tool card (TASK-M3-01): code block with the file path header and
// the file content from the call output in a scrollable mono pre (no
// highlighting yet — Shiki hydration can reuse the markdown pipeline later).

import { Show } from "solid-js";
import { CopyButton, inputString, outputText } from "./shared.js";
import type { ToolCard } from "./shared.js";

const ReadCard: ToolCard = (props) => {
  const filePath = () => inputString(props.part.state.input, ["filePath", "file_path", "path"]);
  const content = () => outputText(props.part);

  return (
    <div data-testid="tool-code" class="space-y-1">
      <div class="flex items-center justify-between gap-2">
        <span class="truncate font-code text-xs text-fg-secondary">{filePath() ?? "Read"}</span>
        <Show when={content().length > 0}>
          <CopyButton text={content()} />
        </Show>
      </div>
      <Show when={content().length > 0}>
        <pre class="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-sm bg-bg-sunken px-2 py-1.5 font-code text-xs leading-relaxed text-fg-secondary">
          {content()}
        </pre>
      </Show>
    </div>
  );
};

export default ReadCard;
