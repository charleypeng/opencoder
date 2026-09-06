// Bash tool card (TASK-M3-01): terminal-style rendering — dark mono block
// with a "$ command" prompt line, the raw output below (scrollable, copy
// button in the terminal header) and an exit-code footer when the tool
// metadata carries one.

import { Show } from "solid-js";
import { CopyButton, inputString, outputText } from "./shared.js";
import type { ToolCard } from "./shared.js";
import { useT } from "../../../../i18n/index.js";

const BashCard: ToolCard = (props) => {
  const t = useT();
  const command = () => inputString(props.part.state.input, ["command", "cmd"]);
  const output = () => outputText(props.part);
  const exitCode = () => {
    if (props.part.state.status === "pending") return undefined;
    const metadata = (props.part.state.metadata ?? {}) as Record<string, unknown>;
    return typeof metadata.exitCode === "number" ? metadata.exitCode : undefined;
  };

  return (
    <div
      data-testid="tool-terminal"
      class="overflow-hidden rounded-sm bg-bg-sunken font-code text-xs"
    >
      <div class="flex items-center justify-between gap-2 border-b border-bg-base/40 px-2 py-1">
        <span class="truncate text-fg-faint">{t("messages:toolTerminal")}</span>
        <Show when={output().length > 0}>
          <CopyButton text={output()} />
        </Show>
      </div>
      <div class="space-y-1 px-2 py-1.5">
        <Show when={command() !== undefined}>
          <div class="text-fg-primary">
            <span class="select-none text-success">{"$\u00a0"}</span>
            {command()}
          </div>
        </Show>
        <Show when={output().length > 0}>
          <pre class="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-fg-secondary">
            {output()}
          </pre>
        </Show>
        <Show when={props.part.state.status === "completed" && output().length === 0}>
          <span data-testid="tool-no-output" class="text-fg-faint">
            {t("messages:toolNoOutput")}
          </span>
        </Show>
        <Show when={exitCode() !== undefined}>
          <div class="text-fg-faint">{t("messages:exitCode", { code: exitCode() })}</div>
        </Show>
      </div>
    </div>
  );
};

export default BashCard;
