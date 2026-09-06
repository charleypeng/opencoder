// Tool call disclosure renders pending, running, completed, and error states
// as a compact inline row. Expanding reveals the existing per-tool details
// without making long commands or output dominate the conversation.

import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import type { Component, JSX } from "solid-js";
import { createMessageService } from "../../../services/message.js";
import { getApiClient } from "../../../services/client.js";
import type { Part } from "../../../stores/messages.js";
import { resolveToolCard } from "./tools/registry.js";
import { ContentIcon, toolIconKind } from "./icons.js";
import { durationLabel, inputString } from "./tools/shared.js";
import { useT } from "../../../i18n/index.js";
import type { ToolCard } from "./tools/shared.js";
import {
  readActivityEntryExpanded,
  writeActivityEntryExpanded,
} from "../activity/activityViewState.js";

export type ToolPartData = Extract<Part, { type: "tool" }>;
export type ToolStatus = ToolPartData["state"]["status"];

export interface ToolPartProps {
  part: ToolPartData;
  /** Stable run-and-part key for restoring disclosure after virtualization. */
  disclosureKey?: string;
}

// IA-19: Status text formula = action verb + object + scope.
// The status labels include the tool name for context.
const statusLabelKey: Record<ToolStatus, string> = {
  pending: "messages:statusWaiting",
  running: "messages:statusRunning",
  completed: "messages:statusCompleted",
  error: "messages:statusFailed",
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

function mergeToolDetails(part: ToolPartData, loaded: ToolPartData | undefined): ToolPartData {
  if (part.state.status !== "completed" || loaded?.state.status !== "completed") return part;
  return {
    ...part,
    state: {
      ...part.state,
      // A detail response can fill omitted edit/read parameters, but live SSE
      // state remains authoritative for output, status, timing and metadata.
      input: { ...loaded.state.input, ...part.state.input },
    },
  };
}

function needsDetails(part: ToolPartData): boolean {
  if (part.state.status !== "completed") return false;
  if (toolSummaryAction(part.tool) !== "edit") return false;
  const input = part.state.input as Record<string, unknown>;
  return (
    (typeof input.oldString !== "string" && typeof input.old_string !== "string") ||
    (typeof input.newString !== "string" && typeof input.new_string !== "string")
  );
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
  const [expanded, setExpanded] = createSignal(
    untrack(() =>
      props.disclosureKey === undefined
        ? false
        : readActivityEntryExpanded(props.disclosureKey, props.part.id),
    ),
  );
  const [loadedPart, setLoadedPart] = createSignal<ToolPartData>();
  const [detailState, setDetailState] = createSignal<"idle" | "loading" | "failed">("idle");
  const detailId = createUniqueId();
  let disposed = false;
  const status = () => props.part.state.status;
  const isExpanded = () => expanded();

  onCleanup(() => {
    disposed = true;
  });

  async function loadDetails(): Promise<void> {
    if (!needsDetails(props.part) || detailState() === "loading") return;
    setDetailState("loading");
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
      if (disposed) return;
      if (part?.type === "tool") {
        setLoadedPart(part as ToolPartData);
        setDetailState("idle");
      } else {
        setDetailState("failed");
      }
    } catch {
      if (!disposed) setDetailState("failed");
    }
  }

  function toggleExpanded(): void {
    const next = !isExpanded();
    setExpanded(next);
    if (props.disclosureKey !== undefined) {
      writeActivityEntryExpanded(props.disclosureKey, props.part.id, next);
    }
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
  const detailPart = createMemo(() => mergeToolDetails(props.part, loadedPart()));
  const card = createMemo(() => resolveToolCard(detailPart().tool));
  const summary = createMemo(() => {
    const action = toolSummaryAction(props.part.tool);
    if (isExpanded() && action === "run") return t("messages:toolSummaryCommand");
    const target = toolSummaryTarget(props.part);
    return t(`messages:toolSummary${action[0].toUpperCase()}${action.slice(1)}`, { target });
  });

  return (
    <div data-testid="tool-part" data-status={status()} class="reply-tool my-1 min-w-0">
      <button
        type="button"
        data-testid="tool-toggle"
        aria-expanded={isExpanded()}
        aria-controls={detailId}
        class="flex min-w-0 w-full items-center gap-1.5 rounded-sm py-1 text-left text-sm outline-none hover:bg-bg-sunken/50 focus:bg-accent-soft"
        onClick={toggleExpanded}
      >
        <span
          aria-hidden
          class={`mt-px inline-block shrink-0 text-fg-faint transition-transform ${
            isExpanded() ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>
        <ContentIcon kind={toolIconKind(props.part.tool)} class="text-fg-faint" />
        <span
          data-testid="tool-summary"
          class={`min-w-0 flex-1 font-code text-fg-secondary ${
            isExpanded() ? "whitespace-pre-wrap break-words" : "truncate"
          }`}
        >
          {summary()}
        </span>
        <Show when={duration() !== undefined}>
          <span data-testid="tool-duration" class="shrink-0 font-code text-xs text-fg-faint">
            {duration()}
          </span>
        </Show>
        <span data-testid="tool-status-label" class="sr-only">
          {t(statusLabelKey[status()], { tool: props.part.tool })}
        </span>
      </button>
      <Show when={isExpanded()}>
        <div id={detailId} data-testid="tool-detail" class="reply-tool-detail mt-1 space-y-2">
          {detailState() === "loading" ? (
            <span data-testid="tool-detail-loading" class="text-xs text-fg-faint">
              {t("messages:toolDetailLoading")}
            </span>
          ) : detailState() === "failed" ? (
            <span data-testid="tool-detail-error" class="text-xs text-danger">
              {t("messages:toolDetailError")}
            </span>
          ) : null}
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
