// Tool call card (TASK-M3-01, full): renders a ToolPart through the full
// four-state machine (pending / running / completed / error) with per-tool
// renderers from tools/ (bash terminal, edit diff, read/write code blocks,
// glob/grep result lists, generic JSON fallback). Shared chrome: status
// icon, per-tool icon, running shimmer sweep, live elapsed time while
// running, a collapsible raw-input disclosure, and the error message for
// failed calls. Icons are inline SVGs / CSS spinners — no emoji.

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import { createMessageService } from "../../../services/message.js";
import { getApiClient } from "../../../services/client.js";
import type { Part } from "../../../stores/messages.js";
import { resolveToolCard } from "./tools/registry.js";
import { durationLabel, inputString, StatusIcon, ToolIcon } from "./tools/shared.js";
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

type ToolSummaryAction = "run" | "read" | "edit" | "write" | "search" | "ask" | "use";

function toolSummaryAction(tool: string): ToolSummaryAction {
  if (/^(bash|shell|exec|terminal|command|run)$/i.test(tool)) return "run";
  if (tool === "read") return "read";
  if (tool === "edit") return "edit";
  if (tool === "write") return "write";
  if (/^(glob|grep)$/i.test(tool)) return "search";
  if (tool === "question") return "ask";
  return "use";
}

function questionTarget(input: Record<string, unknown>): string | undefined {
  const questions = input.questions;
  if (!Array.isArray(questions)) return undefined;
  const first = questions[0];
  if (first === null || typeof first !== "object") return undefined;
  const question = first as Record<string, unknown>;
  return inputString(question, ["header", "question", "label"]);
}

function toolSummaryTarget(part: ToolPartData): string {
  const input = part.state.input as Record<string, unknown>;
  const action = toolSummaryAction(part.tool);
  const fromInput =
    action === "run"
      ? inputString(input, ["command", "cmd"])
      : action === "read" || action === "edit" || action === "write"
        ? inputString(input, ["filePath", "file_path", "path"])
        : action === "search"
          ? inputString(input, ["pattern", "query"])
          : action === "ask"
            ? questionTarget(input)
            : undefined;
  if (fromInput !== undefined && fromInput.trim() !== "") return fromInput;

  const title =
    part.state.status === "running" || part.state.status === "completed"
      ? part.state.title
      : undefined;
  return title !== undefined && title.toLowerCase() !== part.tool.toLowerCase() ? title : part.tool;
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
  const [loadedPart, setLoadedPart] = createSignal<ToolPartData>();
  let disposed = false;
  const status = () => props.part.state.status;

  onCleanup(() => {
    disposed = true;
  });

  async function loadDetails(): Promise<void> {
    try {
      const message = await createMessageService(getApiClient()).get(
        props.part.sessionID,
        props.part.messageID,
      );
      const part = message.parts.find(
        (candidate) =>
          candidate.type === "tool" &&
          (candidate.id === props.part.id || candidate.callID === props.part.callID),
      );
      if (!disposed && part?.type === "tool") setLoadedPart(part as ToolPartData);
    } catch {
      // The local event payload remains the fallback when the detail request fails.
    }
  }

  function toggleExpanded(): void {
    const next = !expanded();
    setExpanded(next);
    if (next && loadedPart() === undefined) void loadDetails();
  }

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
  const detailPart = createMemo(() => loadedPart() ?? props.part);
  const card = createMemo(() => resolveToolCard(detailPart().tool));
  const summary = createMemo(() => {
    const action = toolSummaryAction(props.part.tool);
    const target = toolSummaryTarget(props.part);
    return t(`messages:toolSummary${action[0].toUpperCase()}${action.slice(1)}`, { target });
  });

  return (
    <div
      data-testid="tool-part"
      data-status={status()}
      class={`my-1 min-w-0 rounded-md bg-bg-sunken/50${statusBgClass[status()] !== "" ? " " + statusBgClass[status()] : ""}`}
    >
      <button
        type="button"
        data-testid="tool-toggle"
        aria-expanded={expanded()}
        class="relative flex min-w-0 w-full items-start gap-2 px-2 py-1.5 text-left text-xs outline-none focus:bg-accent-soft"
        onClick={toggleExpanded}
      >
        <span
          aria-hidden
          class={`mt-px inline-block shrink-0 text-fg-faint transition-transform ${
            expanded() ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>
        <StatusIcon status={status()} />
        <ToolIcon tool={props.part.tool} />
        <span
          data-testid="tool-summary"
          class="min-w-0 flex-1 break-words font-code font-medium leading-relaxed text-fg-primary"
        >
          {summary()}
        </span>
        <Show when={duration() !== undefined}>
          <span data-testid="tool-duration" class="mt-px shrink-0 font-code text-fg-faint">
            {duration()}
          </span>
        </Show>
        <span data-testid="tool-status-label" class="sr-only">
          {t(statusLabelKey[status()], { tool: props.part.tool })}
        </span>
        <Show when={status() === "running"}>
          <span data-testid="tool-shimmer" class="tool-shimmer" aria-hidden />
        </Show>
      </button>
      {/* IA-28: expanded content with monospace font for JSON input/output */}
      <Show when={expanded()}>
        <div class="space-y-2 border-t border-bg-sunken px-2 py-2">
          <ToolCardView card={card()} part={detailPart()} />
          <Show when={detailPart().state.status === "error"}>
            <div
              data-testid="tool-error"
              class="whitespace-pre-wrap break-words rounded-sm bg-danger/10 px-2 py-1.5 font-code text-xs leading-relaxed text-danger"
            >
              {toolErrorText(detailPart())}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default ToolPart;
