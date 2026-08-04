// Write tool card (TASK-M3-01): code block like read, showing the written
// content from the call input (the output carries the same content).

import { Show } from "solid-js";
import { CopyButton, inputString, outputText } from "./shared.js";
import type { ToolCard } from "./shared.js";

const WriteCard: ToolCard = (props) => {
  const filePath = () => inputString(props.part.state.input, ["filePath", "file_path", "path"]);
  const content = () =>
    inputString(props.part.state.input, ["content", "contents"]) ?? outputText(props.part);

  return (
    <div data-testid="tool-code" class="space-y-1">
      <div class="flex items-center justify-between gap-2">
        <span class="truncate font-code text-xs text-fg-secondary">{filePath() ?? "Write"}</span>
        <Show when={content().length > 0}>
          <CopyButton text={content()} />
        </Show>
      </div>
      <Show when={content().length > 0}>
        <pre class="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-sm bg-bg-sunken px-2 py-1.5 font-code text-xs leading-relaxed text-fg-secondary">
          {content()}
        </pre>
      </Show>
    </div>
  );
};

export default WriteCard;
