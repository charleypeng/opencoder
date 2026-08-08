// Compaction notice (TASK-M3-04): renders a CompactionPart as a system line
// "Context compacted" with a compress icon. The 1.18.11 schema carries no
// human-readable summary, so the expandable detail lists what the contract
// provides: auto/manual mode, the overflow flag and the tail part id (the
// part the compaction truncated). When the part has no detail fields, the
// line renders on its own without a toggle.

import { createMemo, createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { useT } from "../../../i18n/index.js";

export type CompactionPartData = Extract<Part, { type: "compaction" }>;

export interface CompactionPartProps {
  part: CompactionPartData;
}

function CompressIcon() {
  return (
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
      <path d="M6.5 2.5v3h-3" />
      <path d="M9.5 2.5v3h3" />
      <path d="M6.5 13.5v-3h-3" />
      <path d="M9.5 13.5v-3h3" />
    </svg>
  );
}

const CompactionPart: Component<CompactionPartProps> = (props) => {
  const t = useT();
  const [expanded, setExpanded] = createSignal(false);

  // Detail fields are optional in the schema; without any the line stands
  // alone and there is nothing to expand.
  const hasDetail = createMemo(
    () => props.part.overflow === true || props.part.tail_start_id !== undefined,
  );

  return (
    <div
      data-testid="compaction-part"
      class="my-1 inline-flex w-fit flex-col overflow-hidden rounded-md bg-bg-sunken/40 text-xs text-fg-secondary"
    >
      <Show
        when={hasDetail()}
        fallback={
          <span class="flex w-full items-center gap-1.5 px-2 py-1">
            <CompressIcon />
            <span class="font-medium text-fg-primary">{t("messages:compacted")}</span>
          </span>
        }
      >
        <button
          type="button"
          data-testid="compaction-toggle"
          aria-expanded={expanded()}
          class="flex w-full items-center gap-1.5 px-2 py-1 text-left outline-none focus:bg-accent-soft"
          onClick={() => setExpanded((value) => !value)}
        >
          <CompressIcon />
          <span class="font-medium text-fg-primary">{t("messages:compacted")}</span>
          <span
            aria-hidden
            class={`inline-block shrink-0 text-fg-faint transition-transform ${
              expanded() ? "rotate-90" : ""
            }`}
          >
            ▸
          </span>
        </button>
      </Show>
      <Show when={hasDetail() && expanded()}>
        <div
          data-testid="compaction-detail"
          class="flex flex-col gap-0.5 border-t border-bg-sunken px-2 py-1.5 text-fg-faint"
        >
          <span data-testid="compaction-mode">
            {props.part.auto ? t("messages:autoCompaction") : t("messages:manualCompaction")}
          </span>
          <Show when={props.part.overflow === true}>
            <span data-testid="compaction-overflow">{t("messages:contextOverflowed")}</span>
          </Show>
          <Show when={props.part.tail_start_id !== undefined}>
            <span data-testid="compaction-tail">
              {t("messages:tailStartsAt", { id: props.part.tail_start_id })}
            </span>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default CompactionPart;
