// Reply activity keeps observable agent work in reading order before the final
// answer. Live runs start open, historical runs stay compact, and individual
// thoughts and tools disclose their details without turning the reply into a
// nested timeline card.
//
// PROCESS-REF-02: the run carries ONE tail status slot that moves to the end
// of the rendered progress while active; historical reasoning originals are
// summarized behind a single quiet "thought details" disclosure instead of a
// repeated thinking row per part.

import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { useT } from "../../../i18n/index.js";
import { deriveActivityTrace } from "../activity/deriveActivityTrace.js";
import { deriveProcessStatus, type ProcessStatus } from "../activity/processStatus.js";
import {
  readActivityEntryExpanded,
  readActivityExpanded,
  hasActivityExpandedChoice,
  writeActivityEntryExpanded,
  writeActivityExpanded,
} from "../activity/activityViewState.js";
import CompactionPart, { type CompactionPartData } from "./CompactionPart.js";
import ReasoningPart, { type ReasoningPartData } from "./ReasoningPart.js";
import RetryPart, { type RetryPartData } from "./RetryPart.js";
import TextPart, { type TextPartData } from "./TextPart.js";
import ToolPart, { type ToolPartData } from "./ToolPart.js";
import { ContentIcon } from "./icons.js";

export interface ProcessFoldProps {
  /** Observable parts belonging to one assistant run. */
  parts: Array<Part | undefined>;
  /** Stable assistant-message key used to keep runs isolated. */
  runKey?: string;
  /** Marks this run active without forcing its disclosure open. */
  active?: boolean;
  /** Run timestamps used for the task-level elapsed label. */
  startedAt?: number;
  completedAt?: number;
  /** Kept for callers that still expose the recent-delta streaming flag. */
  streaming?: boolean;
  /** True while the run's answer text itself is streaming; the tail status
   *  then stays quiet unless another real activity is in flight. */
  contentStreaming?: boolean;
  /** A pending permission/question request for this session: the run is
   *  waiting on the user, so the status says so instead of "thinking". */
  waitingUser?: "permission" | "question";
}

function formatElapsed(t: ReturnType<typeof useT>, milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (totalSeconds < 60) {
    return t("messages:activityDurationSeconds", { seconds: totalSeconds });
  }
  return t("messages:activityDurationMinutes", {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  });
}

/** Visible tail-status text; only server-provided previews are ever shown. */
function tailStatusText(t: ReturnType<typeof useT>, status: ProcessStatus): string {
  switch (status.kind) {
    case "waiting-model":
      return t("messages:activityWaitingForModel");
    case "waiting-user":
      return t(
        status.channel === "question"
          ? "messages:activityWaitingForAnswer"
          : "messages:activityWaitingForApproval",
      );
    case "reasoning":
      return status.preview ?? t("messages:activityThinking");
    case "tool":
      if (status.running > 1) return t("messages:activityRunningCount", { count: status.running });
      if (status.running === 0) {
        return t("messages:statusWaiting", { tool: status.tool ?? t("messages:toolNameFallback") });
      }
      return t("messages:statusRunning", {
        tool: status.tool ?? t("messages:toolNameFallback"),
      });
    case "retry":
      return t("messages:retrying");
    case "idle":
      return "";
  }
}

/** Localized phase label announced to assistive technology on kind changes. */
function tailStatusPhase(t: ReturnType<typeof useT>, status: ProcessStatus): string {
  switch (status.kind) {
    case "waiting-model":
      return t("messages:activityWaitingForModel");
    case "waiting-user":
      return t(
        status.channel === "question"
          ? "messages:activityWaitingForAnswer"
          : "messages:activityWaitingForApproval",
      );
    case "reasoning":
      return t("messages:activityThinking");
    case "tool":
      return status.running === 0
        ? t("messages:statusWaiting", { tool: status.tool ?? t("messages:toolNameFallback") })
        : t("messages:statusRunning", { tool: status.tool ?? t("messages:toolNameFallback") });
    case "retry":
      return t("messages:retrying");
    case "idle":
      return "";
  }
}

/** True while the status describes moving work and may carry the sweep. */
function tailStatusAnimated(status: ProcessStatus): boolean {
  return status.kind === "waiting-model" || status.kind === "reasoning" || status.kind === "tool";
}

const TailStatus: Component<{ status: ProcessStatus; t: ReturnType<typeof useT> }> = (props) => {
  // aria-live sits on a phase-only label so preview text updates are never
  // re-announced token by token; the visible slot carries the full text.
  return (
    <Show when={props.status.kind !== "idle"}>
      <span
        data-testid="process-tail-status"
        data-kind={props.status.kind}
        data-animated={tailStatusAnimated(props.status) ? "true" : "false"}
        class="reply-tail-status min-w-0 truncate text-xs text-fg-secondary"
      >
        <span class="sr-only" role="status" aria-live="polite">
          {tailStatusPhase(props.t, props.status)}
        </span>
        <span aria-hidden="true" class="reply-tail-status-text">
          {tailStatusText(props.t, props.status)}
        </span>
      </span>
    </Show>
  );
};

const ProcessFold: Component<ProcessFoldProps> = (props) => {
  const t = useT();
  const traceKey = () => props.runKey ?? "run";
  const [now, setNow] = createSignal(Date.now());
  const [viewVersion, setViewVersion] = createSignal(0);
  const trace = createMemo(() => deriveActivityTrace(props.parts, now(), traceKey()));
  // Reasoning originals leave the default reading flow; they live behind one
  // quiet disclosure so the run never shows a repeated thinking row.
  const reasoningEntries = createMemo(() => trace().filter((entry) => entry.kind === "summary"));
  const flowEntries = createMemo(() => trace().filter((entry) => entry.kind !== "summary"));
  const [expanded, setExpanded] = createSignal(
    untrack(() => readActivityExpanded(traceKey(), props.active === true)),
  );
  const bodyId = createUniqueId();
  const thoughtId = createUniqueId();

  function toggleExpanded(): void {
    if (trace().length === 0) return;
    const next = !expanded();
    setExpanded(next);
    writeActivityExpanded(traceKey(), next);
  }

  function toggleThoughtDetails(): void {
    writeActivityEntryExpanded(
      traceKey(),
      "thought-details",
      !readActivityEntryExpanded(traceKey(), "thought-details"),
    );
    setViewVersion((version) => version + 1);
  }

  function thoughtDetailsExpanded(): boolean {
    viewVersion();
    return readActivityEntryExpanded(traceKey(), "thought-details");
  }

  // PROCESS-REF-01: activity comes only from the authoritative run flag, never
  // from a part's own status — a historical reasoning entry missing `time.end`
  // must not keep a finished run permanently active.
  const active = createMemo(() => props.active === true || props.streaming === true);
  // PROCESS-REF-01 §4: attention is only honest while the failed entry is the
  // latest observable activity — a recovered retry or a later successful tool
  // must not keep the whole run marked red.
  const failed = createMemo(() => {
    const entries = trace();
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (entry.kind === "note") continue;
      return entry.status === "failed";
    }
    return false;
  });
  const hasDetails = createMemo(() => trace().length > 0);

  // Completion auto-collapse applies only to runs the user never explicitly
  // folded or unfolded; an explicit choice is preserved across the finish.
  createEffect(() => {
    if (active()) return;
    if (hasActivityExpandedChoice(traceKey())) return;
    setExpanded(false);
  });

  createEffect(() => {
    if (!active()) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });
  const statusLabel = createMemo(() => {
    if (failed()) return t("messages:activityNeedsAttention");
    const startedAt = props.startedAt;
    if (active()) {
      if (props.waitingUser === "question") return t("messages:activityWaitingForAnswer");
      if (props.waitingUser === "permission") return t("messages:activityWaitingForApproval");
      if (startedAt === undefined) return t("messages:activityWorking");
      return t("messages:activityWorkingFor", {
        duration: formatElapsed(t, now() - startedAt),
      });
    }
    if (startedAt !== undefined && props.completedAt !== undefined) {
      return t("messages:activityWorkedFor", {
        duration: formatElapsed(t, props.completedAt - startedAt),
      });
    }
    return t("messages:activityCompleted");
  });

  // The one tail status: rendered at the end of the flow while expanded, or
  // beside the elapsed header while collapsed — never both at once.
  const tailStatus = createMemo(() =>
    deriveProcessStatus(props.parts, {
      active: active(),
      contentStreaming: props.contentStreaming === true,
      waitingUser: props.waitingUser,
      now: now(),
    }),
  );
  const tailStatusBesideHeader = createMemo(() => !expanded() || !hasDetails());

  return (
    <div
      data-testid="process-fold"
      data-active={active() ? "true" : "false"}
      data-status={failed() ? "error" : active() ? "active" : "complete"}
      class="reply-activity my-3"
    >
      <button
        type="button"
        data-testid="process-fold-toggle"
        aria-expanded={expanded()}
        aria-controls={bodyId}
        disabled={!hasDetails()}
        class="reply-activity-header flex min-h-8 w-full items-center gap-1.5 border-b border-bg-sunken py-1 text-left text-sm outline-none focus:bg-accent-soft disabled:cursor-default"
        onClick={toggleExpanded}
      >
        <span class="inline-block w-3 shrink-0 text-fg-faint" aria-hidden="true">
          {hasDetails() ? (
            <span class={`inline-block transition-transform ${expanded() ? "rotate-90" : ""}`}>
              ▸
            </span>
          ) : null}
        </span>
        <span data-testid="process-fold-status" class="min-w-0 truncate text-fg-secondary">
          {statusLabel()}
        </span>
        <Show when={tailStatusBesideHeader()}>
          <TailStatus status={tailStatus()} t={t} />
        </Show>
      </button>
      <Show when={hasDetails()}>
        <div
          id={bodyId}
          data-testid="process-fold-body"
          data-expanded={expanded()}
          aria-hidden={expanded() ? "false" : "true"}
          class="reply-activity-body"
        >
          <div class="reply-activity-items space-y-3 pt-3">
            <For each={flowEntries()}>
              {(entry) => (
                <div
                  data-testid="activity-entry"
                  data-kind={entry.kind}
                  data-status={entry.status}
                  class={`reply-activity-entry min-w-0 ${
                    entry.part.type === "text" ? "reply-activity-progress" : ""
                  }`}
                >
                  <Show when={entry.part.type === "text"}>
                    <TextPart part={entry.part as TextPartData} />
                  </Show>
                  <Show when={entry.part.type === "tool"}>
                    <ToolPart
                      part={entry.part as ToolPartData}
                      disclosureKey={`${traceKey()}:${entry.id}`}
                    />
                  </Show>
                  <Show when={entry.part.type === "compaction"}>
                    <CompactionPart part={entry.part as CompactionPartData} />
                  </Show>
                  <Show when={entry.part.type === "retry"}>
                    <RetryPart part={entry.part as RetryPartData} />
                  </Show>
                </div>
              )}
            </For>
            <Show when={reasoningEntries().length > 0}>
              <div data-testid="thought-details" class="reply-activity-entry min-w-0">
                <button
                  type="button"
                  data-testid="thought-details-toggle"
                  aria-expanded={thoughtDetailsExpanded()}
                  aria-controls={thoughtId}
                  class="flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left text-xs text-fg-faint outline-none focus:bg-accent-soft"
                  onClick={toggleThoughtDetails}
                >
                  <ContentIcon kind="reasoning" />
                  <span
                    aria-hidden="true"
                    class={`inline-block shrink-0 transition-transform ${
                      thoughtDetailsExpanded() ? "rotate-90" : ""
                    }`}
                  >
                    ▸
                  </span>
                  <span class="truncate">{t("messages:thoughtDetails")}</span>
                </button>
                <Show when={thoughtDetailsExpanded()}>
                  <div id={thoughtId} data-testid="thought-details-body" class="space-y-2 pt-1">
                    <For each={reasoningEntries()}>
                      {(entry) => <ReasoningPart part={entry.part as ReasoningPartData} />}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={!tailStatusBesideHeader()}>
              <div class="flex min-w-0 items-center">
                <TailStatus status={tailStatus()} t={t} />
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default ProcessFold;
