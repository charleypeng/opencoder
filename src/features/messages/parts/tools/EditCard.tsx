// Edit tool card (TASK-M3-01): inline diff preview built from the call
// input (filePath + oldString/newString). Lines are diffed with a common
// prefix/suffix trim (no diff library); removals render red with a "-",
// additions green with a "+", unchanged lines as context. The edit output
// (the new file content) is available under the copy button.

import { createMemo, For, Show } from "solid-js";
import { CopyButton, inputString, outputText } from "./shared.js";
import type { ToolCard } from "./shared.js";

type DiffRow = { kind: "ctx" | "del" | "add"; text: string };

/** Line diff via common prefix/suffix trim — compact for the small edits a
 *  tool call applies; not a general-purpose diff algorithm. */
function diffLines(oldText: string, newText: string): DiffRow[] {
  const oldLines = oldText === "" ? [] : oldText.split("\n");
  const newLines = newText === "" ? [] : newText.split("\n");
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start += 1;
  }
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld -= 1;
    endNew -= 1;
  }
  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i++) rows.push({ kind: "ctx", text: oldLines[i] });
  for (let i = start; i < endOld; i++) rows.push({ kind: "del", text: oldLines[i] });
  for (let i = start; i < endNew; i++) rows.push({ kind: "add", text: newLines[i] });
  for (let i = endOld; i < oldLines.length; i++) rows.push({ kind: "ctx", text: oldLines[i] });
  return rows;
}

const EditCard: ToolCard = (props) => {
  const input = () => props.part.state.input;
  const filePath = () => inputString(input(), ["filePath", "file_path", "path"]);
  const oldString = () => inputString(input(), ["oldString", "old_string"]) ?? "";
  const newString = () => inputString(input(), ["newString", "new_string"]) ?? "";
  const rows = createMemo(() => diffLines(oldString(), newString()));
  const output = () => outputText(props.part);

  return (
    <div data-testid="tool-diff" class="space-y-1">
      <div class="flex items-center justify-between gap-2">
        <span class="truncate font-code text-xs text-fg-secondary">{filePath() ?? "Edit"}</span>
        <Show when={output().length > 0}>
          <CopyButton text={output()} />
        </Show>
      </div>
      <Show
        when={rows().length > 0}
        fallback={
          <pre class="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-sm bg-bg-sunken px-2 py-1.5 font-code text-xs text-fg-secondary">
            {output()}
          </pre>
        }
      >
        <div class="max-h-80 overflow-y-auto rounded-sm bg-bg-sunken px-2 py-1 font-code text-xs leading-relaxed">
          <For each={rows()}>
            {(row) => (
              <div
                class={`whitespace-pre-wrap break-words px-1 ${
                  row.kind === "add"
                    ? "bg-success/15 text-success"
                    : row.kind === "del"
                      ? "bg-danger/15 text-danger"
                      : "text-fg-secondary"
                }`}
              >
                {row.kind === "add" ? "+ " : row.kind === "del" ? "- " : "  "}
                {row.text}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default EditCard;
