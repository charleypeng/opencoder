// Tool call card (TASK-M3-01, full): renders a ToolPart through the full
// four-state machine (pending / running / completed / error) with per-tool
// renderers from tools/ (bash terminal, edit diff, read/write code blocks,
// glob/grep result lists, generic JSON fallback). Shared chrome: status
// icon, per-tool icon, running shimmer sweep, live elapsed time while
// running, a collapsible raw-input disclosure, and the error message for
// failed calls. Icons are inline SVGs / CSS spinners — no emoji.

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { resolveToolCard } from "./tools/registry.js";
import { durationLabel, StatusIcon, ToolIcon } from "./tools/shared.js";
import { useT } from "../../../i18n/index.js";
import type { ToolCard } from "./tools/shared.js";

export type ToolPartData = Extract<Part, { type: "tool" }>;
export type ToolStatus = ToolPartData["state"]["status"];

export interface ToolPartProps {
  part: ToolPartData;
}

// IA-19: Status text formula = action verb + object + scope.
// The status labels include the tool name for context.
const statusLabelKey: Record<ToolStatus, string> = {
  pending: "messages:statusWaiting",
  running: "messages:statusRunning",
  completed: "messages:statusCompleted",
  error: "messages:statusFailed",
};

// IA-20: State-based background tints for visual distinction.
// Each state has a distinct, WCAG AA-compliant background color.
const statusBgClass: Record<ToolStatus, string> = {
  pending: "",
  running: "border-l-2 border-l-accent",
  completed: "",
  error: "border-l-2 border-l-danger",
};

const ELAPSED_TICK_MS = 250;

/** Error-state text, narrowed for the section render. */
function toolErrorText(part: ToolPartData): string {
  return part.state.status === "error" ? part.state.error : "";
}

function ToolCardView(props: { card: ToolCard; part: ToolPartData }) {
  // Memoized so the registry lookup stays inside a tracked scope.
  const view = createMemo<JSX.Element>(() => {
    const Card = props.card;
    return <Card part={props.part} />;
  });
  return <>{view()}</>;
}

const ToolPart: Component<ToolPartProps> = (props) => {
  const t = useT();
  const [expanded, setExpanded] = createSignal(false);
  const status = () => props.part.state.status;

  // Live elapsed clock: ticks only while running; the interval is cleaned
  // up on every status change and on dispose, so it never outlives the part.
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (status() !== "running") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    onCleanup(() => clearInterval(timer));
  });

  const duration = createMemo(() => durationLabel(props.part.state, now()));
  const card = createMemo(() => resolveToolCard(props.part.tool));

  return (
    <div
      data-testid="tool-part"
      data-status={status()}
      class={`my-1 overflow-hidden rounded-md bg-bg-sunken/50${statusBgClass[status()] !== "" ? " " + statusBgClass[status()] : ""}`}
    >
      <button
        type="button"
        data-testid="tool-toggle"
        aria-expanded={expanded()}
        class="relative flex w-full items-center gap-2 overflow-hidden px-2 py-1.5 text-left text-xs outline-none focus:bg-accent-soft"
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
        <ToolIcon tool={props.part.tool} />
        <span class="truncate font-code font-medium text-fg-primary">{props.part.tool}</span>
        <Show when={duration() !== undefined}>
          <span data-testid="tool-duration" class="shrink-0 font-code text-fg-faint">
            {duration()}
          </span>
        </Show>
        {/* IA-19: status text = action verb + tool name for context */}
        <span data-testid="tool-status-label" class="ml-auto shrink-0 text-fg-faint">
          {t(statusLabelKey[status()], { tool: props.part.tool })}
        </span>
        <Show when={status() === "running"}>
          <span data-testid="tool-shimmer" class="tool-shimmer" aria-hidden />
        </Show>
      </button>
      {/* IA-28: expanded content with monospace font for JSON input/output */}
      <Show when={expanded()}>
        <div class="space-y-2 border-t border-bg-sunken px-2 py-2">
          <ToolCardView card={card()} part={props.part} />
          <Show when={status() === "error"}>
            <div
              data-testid="tool-error"
              class="whitespace-pre-wrap break-words rounded-sm bg-danger/10 px-2 py-1.5 font-code text-xs leading-relaxed text-danger"
            >
              {toolErrorText(props.part)}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default ToolPart;
