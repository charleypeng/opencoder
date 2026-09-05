// Reply activity keeps observable agent work in reading order before the final
// answer. Live runs start open, historical runs stay compact, and individual
// thoughts and tools disclose their details without turning the reply into a
// nested timeline card.

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
import { deriveActivityTrace, type ActivityEntry } from "../activity/deriveActivityTrace.js";
import {
  readActivityEntryExpanded,
  readActivityExpanded,
  writeActivityEntryExpanded,
  writeActivityExpanded,
} from "../activity/activityViewState.js";
import CompactionPart, { type CompactionPartData } from "./CompactionPart.js";
import ReasoningPart, { type ReasoningPartData } from "./ReasoningPart.js";
import RetryPart, { type RetryPartData } from "./RetryPart.js";
import TextPart, { type TextPartData } from "./TextPart.js";
import ToolPart, { type ToolPartData } from "./ToolPart.js";

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

function entryTitle(t: ReturnType<typeof useT>, entry: ActivityEntry): string {
  switch (entry.kind) {
    case "summary":
      return t("messages:activityThinking");
    case "note":
      return t("messages:activityUpdate");
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

function ThoughtDisclosure(props: {
  entry: ActivityEntry;
  t: ReturnType<typeof useT>;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <button
        type="button"
        data-testid="activity-entry-toggle"
        aria-expanded={props.expanded}
        class="reply-activity-thought flex w-full min-w-0 items-center gap-1.5 text-left text-sm text-fg-secondary outline-none focus:bg-accent-soft"
        onClick={() => props.onToggle()}
      >
        <span
          aria-hidden="true"
          class={`inline-block shrink-0 text-fg-faint transition-transform ${
            props.expanded ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>
        <span class="shrink-0 font-medium text-fg-primary">{entryTitle(props.t, props.entry)}</span>
        <Show when={props.entry.preview !== undefined}>
          <span class="min-w-0 flex-1 truncate text-fg-faint">{props.entry.preview}</span>
        </Show>
      </button>
      <Show when={props.expanded}>
        <ReasoningPart part={props.entry.part as ReasoningPartData} />
      </Show>
    </>
  );
}

const ProcessFold: Component<ProcessFoldProps> = (props) => {
  const t = useT();
  const traceKey = () => props.runKey ?? "run";
  const [now, setNow] = createSignal(Date.now());
  const [viewVersion, setViewVersion] = createSignal(0);
  const trace = createMemo(() => deriveActivityTrace(props.parts, now(), traceKey()));
  const [expanded, setExpanded] = createSignal(
    untrack(() => readActivityExpanded(traceKey(), props.active === true)),
  );
  const bodyId = createUniqueId();

  function toggleExpanded(): void {
    if (trace().length === 0) return;
    const next = !expanded();
    setExpanded(next);
    writeActivityExpanded(traceKey(), next);
  }

  function toggleEntry(entryId: string): void {
    writeActivityEntryExpanded(
      traceKey(),
      entryId,
      !readActivityEntryExpanded(traceKey(), entryId),
    );
    setViewVersion((version) => version + 1);
  }

  function entryExpanded(entryId: string): boolean {
    viewVersion();
    return readActivityEntryExpanded(traceKey(), entryId);
  }

  const active = createMemo(
    () =>
      props.active === true ||
      props.streaming === true ||
      trace().some((entry) => entry.status === "active"),
  );
  const failed = createMemo(() => trace().some((entry) => entry.status === "failed"));
  const hasDetails = createMemo(() => trace().length > 0);

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
        <span data-testid="process-fold-status" class="shrink-0 text-fg-secondary">
          {statusLabel()}
        </span>
        <Show when={!hasDetails() && active()}>
          <span data-testid="process-fold-wait" class="min-w-0 truncate text-fg-faint">
            {t("messages:activityWaitingForModel")}
          </span>
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
            <For each={trace()}>
              {(entry) => (
                <div
                  data-testid="activity-entry"
                  data-kind={entry.kind}
                  data-phase={entry.phase}
                  data-status={entry.status}
                  class={`reply-activity-entry min-w-0 ${
                    entry.part.type === "text" ? "reply-activity-progress" : ""
                  }`}
                >
                  <Show when={entry.part.type === "text"}>
                    <TextPart part={entry.part as TextPartData} />
                  </Show>
                  <Show when={entry.part.type === "reasoning"}>
                    <ThoughtDisclosure
                      entry={entry}
                      t={t}
                      expanded={entryExpanded(entry.id)}
                      onToggle={() => toggleEntry(entry.id)}
                    />
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
          </div>
        </div>
      </Show>
    </div>
  );
};

export default ProcessFold;
