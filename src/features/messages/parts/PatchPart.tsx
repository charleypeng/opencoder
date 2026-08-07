// Patch card (TASK-M3-02): renders a PatchPart as a bordered card with a
// short commit-hash badge, a total file count and one row per patched
// file. Rows are click-to-jump placeholders: M4 wires the diff view
// through `onOpenDiff`; until then nothing is passed and the rows are
// inert. The 1.18.11 schema carries no per-file add/del counts (only
// `hash` + `files`), so no +/- count badges are rendered.

import { createMemo, For } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { useT } from "../../../i18n/index.js";

export type PatchPartData = Extract<Part, { type: "patch" }>;

export interface PatchPartProps {
  part: PatchPartData;
  /** Jump-to-diff callback per file; wired by M4's diff view. */
  onOpenDiff?: (file: string) => void;
}

const PatchPart: Component<PatchPartProps> = (props) => {
  const t = useT();
  const shortHash = createMemo(() => props.part.hash.slice(0, 7));

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
      <ul class="border-t border-bg-sunken">
        <For each={props.part.files}>
          {(file) => (
            <li>
              <button
                type="button"
                data-testid="patch-file"
                class="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-fg-secondary outline-none hover:bg-accent-soft hover:text-fg-primary focus:bg-accent-soft"
                onClick={() => props.onOpenDiff?.(file)}
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
                <span class="truncate font-code">{file}</span>
                <span aria-hidden class="ml-auto shrink-0 text-fg-faint">
                  ▸
                </span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
};

export default PatchPart;
