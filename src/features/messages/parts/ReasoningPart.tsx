// Reasoning part renderer (TASK-M2-06): a collapsed-by-default fold whose
// header shows the "Reasoning" label with a chevron and a truncated preview;
// clicking toggles the full reasoning text. No state tracking is needed:
// the part renders whatever text the store holds, so streamed deltas keep
// updating both preview and expanded body (M2-09).

import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { useT } from "../../../i18n/index.js";

export type ReasoningPartData = Extract<Part, { type: "reasoning" }>;

export interface ReasoningPartProps {
  part: ReasoningPartData;
}

const PREVIEW_LENGTH = 60;

const ReasoningPart: Component<ReasoningPartProps> = (props) => {
  const t = useT();
  const [expanded, setExpanded] = createSignal(false);
  const preview = () =>
    props.part.text.length > PREVIEW_LENGTH
      ? `${props.part.text.slice(0, PREVIEW_LENGTH)}…`
      : props.part.text;

  return (
    <div data-testid="reasoning-part" class="my-1 rounded-md bg-bg-sunken/50">
      <button
        type="button"
        data-testid="reasoning-toggle"
        aria-expanded={expanded()}
        class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs outline-none hover:bg-accent-soft focus:bg-accent-soft"
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          aria-hidden
          class={`inline-block shrink-0 text-fg-faint transition-transform ${
            expanded() ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>
        <span class="shrink-0 font-medium text-fg-secondary">{t("messages:reasoning")}</span>
        <Show when={!expanded()}>
          <span class="truncate text-fg-faint">{preview()}</span>
        </Show>
      </button>
      <Show when={expanded()}>
        <div
          data-testid="reasoning-body"
          class="whitespace-pre-wrap break-words border-t border-bg-sunken px-2 py-2 text-xs leading-relaxed text-fg-secondary"
        >
          {props.part.text}
        </div>
      </Show>
    </div>
  );
};

export default ReasoningPart;
