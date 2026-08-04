// Tool call card (TASK-M2-06, v1): renders a ToolPart as a collapsible card
// showing the tool name, a status icon (pending clock, running spinner,
// completed check, error cross) and a status label. Expanding reveals the
// call input as pretty JSON plus the raw output (completed) or error
// (error state) text. Icons are inline SVGs / CSS spinners — no emoji.

import { createMemo, createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";

export type ToolPartData = Extract<Part, { type: "tool" }>;
export type ToolStatus = ToolPartData["state"]["status"];

export interface ToolPartProps {
  part: ToolPartData;
}

const statusLabel: Record<ToolStatus, string> = {
  pending: "Pending",
  running: "Running…",
  completed: "Completed",
  error: "Failed",
};

function StatusIcon(props: { status: ToolStatus }) {
  // Memoized so the switch stays inside a tracked scope (the status of a
  // part identity never changes while rendering).
  const icon = createMemo(() => {
    switch (props.status) {
      case "running":
        return (
          <span
            aria-hidden
            class="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
          />
        );
      case "completed":
        return (
          <svg
            aria-hidden
            class="h-3.5 w-3.5 shrink-0 text-success"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        );
      case "error":
        return (
          <svg
            aria-hidden
            class="h-3.5 w-3.5 shrink-0 text-danger"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        );
      default:
        return (
          <svg
            aria-hidden
            class="h-3.5 w-3.5 shrink-0 text-fg-faint"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          >
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 5v3l2 1.5" />
          </svg>
        );
    }
  });
  return <>{icon()}</>;
}

function ToolSection(props: { label: string; code: string }) {
  return (
    <div>
      <p class="mb-0.5 text-[10px] uppercase tracking-wide text-fg-faint">{props.label}</p>
      <pre class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-sm bg-bg-sunken px-2 py-1.5 font-code text-xs leading-relaxed text-fg-secondary">
        {props.code}
      </pre>
    </div>
  );
}

/** Completed-state output text, narrowed for the section render. */
function toolOutputText(part: ToolPartData): string {
  return part.state.status === "completed" ? part.state.output : "";
}

/** Error-state text, narrowed for the section render. */
function toolErrorText(part: ToolPartData): string {
  return part.state.status === "error" ? part.state.error : "";
}

const ToolPart: Component<ToolPartProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const status = () => props.part.state.status;

  return (
    <div
      data-testid="tool-part"
      data-status={status()}
      class="my-1 overflow-hidden rounded-md border border-bg-sunken bg-bg-sunken/60"
    >
      <button
        type="button"
        data-testid="tool-toggle"
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
        <StatusIcon status={status()} />
        <span class="truncate font-code font-medium text-fg-primary">{props.part.tool}</span>
        <span data-testid="tool-status-label" class="ml-auto shrink-0 text-fg-faint">
          {statusLabel[status()]}
        </span>
      </button>
      <Show when={expanded()}>
        <div class="space-y-2 border-t border-bg-sunken px-2 py-2">
          <ToolSection label="Input" code={JSON.stringify(props.part.state.input, null, 2)} />
          <Show when={props.part.state.status === "completed"}>
            <ToolSection label="Output" code={toolOutputText(props.part)} />
          </Show>
          <Show when={props.part.state.status === "error"}>
            <ToolSection label="Error" code={toolErrorText(props.part)} />
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default ToolPart;
