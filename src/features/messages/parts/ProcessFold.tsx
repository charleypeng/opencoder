// Activity Trace (CHAT-TRACE-03/04): keeps observable agent work below the
// answer in one compact disclosure. The trace is collapsed by default even
// while streaming; its active rail communicates progress without taking
// over the conversation. Existing tool/detail renderers remain the source of
// truth for command output, edits, reads and other operation details.

import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { useT } from "../../../i18n/index.js";
import { deriveActivityTrace, type ActivityEntry } from "../activity/deriveActivityTrace.js";
import CompactionPart, { type CompactionPartData } from "./CompactionPart.js";
import ReasoningPart, { type ReasoningPartData } from "./ReasoningPart.js";
import RetryPart, { type RetryPartData } from "./RetryPart.js";
import ToolPart, { type ToolPartData } from "./ToolPart.js";

export interface ProcessFoldProps {
  /** Observable parts belonging to one assistant run. */
  parts: Array<Part | undefined>;
  /** Stable assistant-message key used to keep runs isolated. */
  runKey?: string;
  /** Kept for call-site compatibility; streaming never forces disclosure. */
  streaming?: boolean;
}

interface ProcessStats {
  tools: number;
  ok: number;
  failed: number;
  running: number;
  pending: number;
  thinkingChars: number;
  steps: number;
}

function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

function entryTitle(t: ReturnType<typeof useT>, entry: ActivityEntry): string {
  switch (entry.kind) {
    case "summary":
      return t("messages:activityThinking");
    case "compaction":
      return t("messages:compacted");
    case "retry":
      return t("messages:retrying");
    case "command":
    case "tool":
      return entry.title ?? t("messages:activityOperation");
    case "file-change":
      return t("messages:activityFileChange");
  }
}

function statusClass(entry: ActivityEntry): string {
  switch (entry.status) {
    case "active":
      return "bg-accent";
    case "failed":
    case "blocked":
      return "bg-danger";
    case "queued":
      return "border border-fg-faint bg-transparent";
    default:
      return "bg-success";
  }
}

function traceStatusClass(status: "active" | "error" | "complete"): string {
  if (status === "active") return "bg-accent";
  if (status === "error") return "bg-danger";
  return "bg-success";
}

function renderEntryPart(entry: ActivityEntry) {
  switch (entry.part.type) {
    case "reasoning":
      return <ReasoningPart part={entry.part as ReasoningPartData} />;
    case "tool":
      return <ToolPart part={entry.part as ToolPartData} />;
    case "compaction":
      return <CompactionPart part={entry.part as CompactionPartData} />;
    case "retry":
      return <RetryPart part={entry.part as RetryPartData} />;
    default:
      return null;
  }
}

const ProcessFold: Component<ProcessFoldProps> = (props) => {
  const t = useT();
  const [expanded, setExpanded] = createSignal(false);
  const bodyId = createUniqueId();

  const trace = createMemo(() =>
    deriveActivityTrace(props.parts, Date.now(), props.runKey ?? "run"),
  );
  const stats = createMemo<ProcessStats>(() => {
    const out: ProcessStats = {
      tools: 0,
      ok: 0,
      failed: 0,
      running: 0,
      pending: 0,
      thinkingChars: 0,
      steps: trace().length,
    };
    for (const entry of trace()) {
      if (entry.part.type === "reasoning") out.thinkingChars += entry.part.text.length;
      if (entry.part.type !== "tool") continue;
      out.tools += 1;
      switch (entry.part.state.status) {
        case "completed":
          out.ok += 1;
          break;
        case "error":
          out.failed += 1;
          break;
        case "running":
          out.running += 1;
          break;
        case "pending":
          out.pending += 1;
          break;
      }
    }
    return out;
  });

  const active = createMemo(() => trace().some((entry) => entry.status === "active"));
  const failed = createMemo(() => trace().some((entry) => entry.status === "failed"));
  const current = createMemo(() => {
    const entries = trace();
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry !== undefined && (entry.status === "active" || entry.preview !== undefined)) {
        return entry;
      }
    }
    return undefined;
  });

  const summary = createMemo(() => {
    const s = stats();
    const bits: string[] = [];
    if (s.tools > 0) {
      bits.push(t("messages:processToolCount", { count: s.tools }));
      if (s.ok > 0) bits.push(t("messages:processToolOk", { count: s.ok }));
      if (s.failed > 0) bits.push(t("messages:processToolFailed", { count: s.failed }));
      if (s.running > 0) bits.push(t("messages:processToolRunning", { count: s.running }));
      if (s.pending > 0) bits.push(t("messages:processToolPending", { count: s.pending }));
    }
    if (s.thinkingChars > 0) {
      bits.push(t("messages:processReasoningChars", { chars: formatCompact(s.thinkingChars) }));
    }
    if (bits.length === 0 && s.steps > 0) {
      bits.push(t("messages:activityStepCount", { count: s.steps }));
    }
    return bits.join(" · ");
  });

  const traceStatus = createMemo(() => {
    if (failed()) return "error";
    if (active()) return "active";
    return "complete";
  });

  return (
    <div
      data-testid="process-fold"
      data-active={active() ? "true" : "false"}
      data-status={traceStatus()}
      class="activity-trace my-1 rounded-md bg-bg-sunken/50"
    >
      <button
        type="button"
        data-testid="process-fold-toggle"
        aria-expanded={expanded()}
        aria-controls={bodyId}
        class="flex min-h-10 w-full items-center gap-2 px-2 py-1.5 text-left text-xs outline-none focus:bg-accent-soft"
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          data-testid="activity-trace-status"
          aria-hidden="true"
          class={`h-1.5 w-1.5 shrink-0 rounded-full ${traceStatusClass(traceStatus())}`}
        />
        <span
          aria-hidden="true"
          class={`inline-block shrink-0 text-fg-faint transition-transform ${expanded() ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        <span class="shrink-0 font-medium text-fg-secondary">
          {active()
            ? t("messages:activityWorking")
            : failed()
              ? t("messages:activityNeedsAttention")
              : t("messages:activityCompleted")}
        </span>
        <Show when={current()?.preview !== undefined}>
          <span data-testid="process-fold-current" class="min-w-0 truncate text-fg-faint">
            {current()?.preview}
          </span>
        </Show>
        <span data-testid="process-fold-summary" class="min-w-0 truncate text-fg-faint">
          {summary()}
        </span>
        <span class="ml-auto shrink-0 text-fg-faint" aria-hidden="true">
          {expanded() ? "" : "›"}
        </span>
      </button>
      <div
        id={bodyId}
        data-testid="process-fold-body"
        data-expanded={expanded()}
        aria-hidden={expanded() ? "false" : "true"}
        class="process-fold-body"
      >
        <div class="activity-trace-timeline">
          <For each={trace()}>
            {(entry) => (
              <div
                data-testid="activity-entry"
                data-kind={entry.kind}
                data-phase={entry.phase}
                data-status={entry.status}
                class="activity-trace-entry relative pl-4"
              >
                <span
                  aria-hidden="true"
                  class={`absolute left-0.5 top-3 h-1.5 w-1.5 rounded-full ${statusClass(entry)}`}
                />
                <div class="flex min-w-0 items-center gap-2 px-1 text-[11px] text-fg-secondary">
                  <span class="truncate font-medium text-fg-primary">{entryTitle(t, entry)}</span>
                  <Show when={entry.preview !== undefined}>
                    <span class="min-w-0 truncate text-fg-faint">{entry.preview}</span>
                  </Show>
                </div>
                {renderEntryPart(entry)}
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export default ProcessFold;
