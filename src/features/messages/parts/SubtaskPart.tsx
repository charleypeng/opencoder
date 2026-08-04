// Subtask card (TASK-M3-03): a bordered card whose header shows the prompt
// (title), a branch icon and the agent chip; expanding reveals the
// description plus the model/command meta rows and the M6 child-session
// placeholder note. The 1.18.11 SubtaskPart schema carries no status field
// (so no status badge) and no child session id (so navigation is deferred):
// M6 wires `onOpenChild` once the children relation lands.

import { createMemo, createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { AgentChip } from "./AgentPart.js";

export type SubtaskPartData = Extract<Part, { type: "subtask" }>;

export interface SubtaskPartProps {
  part: SubtaskPartData;
  /** Navigates to the child session; wired by M6's children relation. */
  onOpenChild?: () => void;
}

const SubtaskPart: Component<SubtaskPartProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const modelLabel = createMemo(() => {
    const model = props.part.model;
    return model !== undefined ? `${model.providerID}/${model.modelID}` : undefined;
  });

  return (
    <div
      data-testid="subtask-part"
      class="my-1 overflow-hidden rounded-md border border-bg-sunken bg-bg-sunken/60"
    >
      <button
        type="button"
        data-testid="subtask-toggle"
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
          <circle cx="5" cy="3" r="1.5" />
          <circle cx="5" cy="13" r="1.5" />
          <circle cx="11.5" cy="8" r="1.5" />
          <path d="M5 4.5v7M5 11a4.5 4.5 0 0 1 4.5-3h0.5" />
        </svg>
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
                  <dt class="inline">Model</dt>{" "}
                  <dd data-testid="subtask-model" class="inline font-code text-fg-secondary">
                    {modelLabel()}
                  </dd>
                </div>
              </Show>
              <Show when={props.part.command !== undefined}>
                <div>
                  <dt class="inline">Command</dt>{" "}
                  <dd data-testid="subtask-command" class="inline font-code text-fg-secondary">
                    {props.part.command}
                  </dd>
                </div>
              </Show>
            </dl>
          </Show>
          <p data-testid="subtask-child-note" class="mt-1.5 text-fg-faint">
            Child session navigation lands in M6.
          </p>
        </div>
      </Show>
    </div>
  );
};

export default SubtaskPart;
