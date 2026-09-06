// Subtask card (TASK-M3-03, TASK-M6-07): a bordered card whose header shows
// the prompt (title), a branch icon and the agent chip; expanding reveals
// the description plus the model/command meta rows and an "Open child
// session" button that jumps to the subtask's session. The 1.18.11
// SubtaskPart schema carries no status field (so no status badge) and NO
// child session id (verified against the OpenAPI), so the wired handler
// opens the FIRST child of the part's own session — the caller (M6) knows
// which session that is; without a callback the button is hidden.

import { createMemo, createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { ContentIcon } from "./icons.js";
import { useT } from "../../../i18n/index.js";
import { AgentChip } from "./AgentPart.js";

export type SubtaskPartData = Extract<Part, { type: "subtask" }>;

export interface SubtaskPartProps {
  part: SubtaskPartData;
  /** Navigates to the child session of the session containing this part
   *  (the part's own sessionID); the schema carries no child id, so the
   *  wired handler targets the first child session. Hidden when absent. */
  onOpenChild?: () => void;
}

const SubtaskPart: Component<SubtaskPartProps> = (props) => {
  const t = useT();
  const [expanded, setExpanded] = createSignal(false);
  const modelLabel = createMemo(() => {
    const model = props.part.model;
    return model !== undefined ? `${model.providerID}/${model.modelID}` : undefined;
  });

  return (
    <div data-testid="subtask-part" class="my-1 overflow-hidden rounded-md bg-bg-sunken/50">
      <button
        type="button"
        data-testid="subtask-toggle"
        aria-expanded={expanded()}
        class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs outline-none focus:bg-accent-soft"
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
        <ContentIcon kind="subtask" class="text-fg-faint" />
        <span data-testid="subtask-prompt" class="truncate font-medium text-fg-primary">
          {props.part.prompt}
        </span>
        <span class="ml-auto shrink-0">
          <AgentChip name={props.part.agent} />
        </span>
      </button>
      <Show when={expanded()}>
        <div data-testid="subtask-body" class="border-t border-bg-sunken px-2 py-2 text-xs">
          <p
            data-testid="subtask-description"
            class="whitespace-pre-wrap break-words leading-relaxed text-fg-secondary"
          >
            {props.part.description}
          </p>
          <Show when={modelLabel() !== undefined || props.part.command !== undefined}>
            <dl class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-fg-faint">
              <Show when={modelLabel() !== undefined}>
                <div>
                  <dt class="inline">{t("messages:model")}</dt>{" "}
                  <dd data-testid="subtask-model" class="inline font-code text-fg-secondary">
                    {modelLabel()}
                  </dd>
                </div>
              </Show>
              <Show when={props.part.command !== undefined}>
                <div>
                  <dt class="inline">{t("messages:command")}</dt>{" "}
                  <dd data-testid="subtask-command" class="inline font-code text-fg-secondary">
                    {props.part.command}
                  </dd>
                </div>
              </Show>
            </dl>
          </Show>
          <Show when={props.onOpenChild !== undefined}>
            <button
              type="button"
              data-testid="subtask-open-child"
              class="mt-1.5 w-full rounded-md border border-accent bg-accent-soft px-2 py-1 text-left text-xs font-medium text-accent outline-none hover:bg-accent/15 focus:bg-accent/15"
              onClick={() => props.onOpenChild?.()}
            >
              {t("messages:openChildSession")}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default SubtaskPart;
