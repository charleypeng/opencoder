// Process fold (chat refactor): gathers every intermediate-process part of
// one message (reasoning + tool calls) into a SINGLE fold rendered BELOW the
// answer, instead of interspersed between text parts. Collapsed by default so
// the final answer reads first; the header carries a status summary (call
// count, succeeded / failed / in-progress, reasoning volume) so the user
// knows what happened without expanding. While the session is streaming the
// fold auto-expands so the process is visible live (codex / claude code
// style); when generation ends it auto-collapses. A manual click still wins
// at any time, mirroring the previous per-part reasoning behavior.
//
// Expansion animation: the body is a CSS grid whose row track animates
// 0fr -> 1fr (see .process-fold-body in styles/index.css), so BOTH
// directions are smooth without measuring content height; the duration token
// collapses to 0ms under prefers-reduced-motion (tokens.css).

import { createEffect, createMemo, createSignal, createUniqueId, For } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { useT } from "../../../i18n/index.js";
import ReasoningPart, { type ReasoningPartData } from "./ReasoningPart.js";
import ToolPart, { type ToolPartData } from "./ToolPart.js";

export interface ProcessFoldProps {
  /** The message's process parts (reasoning / tool), in message order. */
  parts: Array<Part | undefined>;
  /** Session-level streaming flag: auto-expands the fold while the agent
   *  is generating and auto-collapses it when generation ends. */
  streaming?: boolean;
}

interface ProcessStats {
  tools: number;
  ok: number;
  failed: number;
  running: number;
  pending: number;
  thinkingChars: number;
}

/** Compact count formatting: 1234 -> "1.2k" (summary keeps the header short). */
function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

const ProcessFold: Component<ProcessFoldProps> = (props) => {
  const t = useT();
  const [expanded, setExpanded] = createSignal(false);
  const bodyId = createUniqueId();

  // Auto-expand while streaming, auto-collapse when it ends. The effect
  // only runs on streaming flips, so a manual click in between still wins.
  createEffect(() => {
    if (props.streaming === true) setExpanded(true);
    else setExpanded(false);
  });

  // Status summary: counts every tool call by its terminal/live state and
  // the total reasoning volume. Reading the part fields inside the memo
  // subscribes to their store updates, so a streamed delta (status flip or
  // more reasoning text) recomputes the summary without remounting.
  const stats = createMemo<ProcessStats>(() => {
    const out: ProcessStats = {
      tools: 0,
      ok: 0,
      failed: 0,
      running: 0,
      pending: 0,
      thinkingChars: 0,
    };
    for (const part of props.parts) {
      if (part === undefined) continue;
      if (part.type === "reasoning") {
        out.thinkingChars += part.text.length;
      } else if (part.type === "tool") {
        out.tools += 1;
        switch (part.state.status) {
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
    }
    return out;
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
    return bits.join(" · ");
  });

  return (
    <div data-testid="process-fold" class="my-1 rounded-md bg-bg-sunken/50">
      <button
        type="button"
        data-testid="process-fold-toggle"
        aria-expanded={expanded()}
        aria-controls={bodyId}
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
        <span class="shrink-0 font-medium text-fg-secondary">{t("messages:processTrail")}</span>
        <span data-testid="process-fold-summary" class="min-w-0 truncate text-fg-faint">
          {summary()}
        </span>
      </button>
      {/* The body stays mounted so the grid-row animation runs in both
          directions; while collapsed it is clipped to zero height, hidden
          from screen readers (aria-hidden) and non-interactive (visibility:
          hidden after the collapse animation — see .process-fold-body). */}
      <div
        id={bodyId}
        data-testid="process-fold-body"
        data-expanded={expanded()}
        aria-hidden={expanded() ? "false" : "true"}
        class="process-fold-body"
      >
        <div>
          <For each={props.parts}>
            {(part) => {
              if (part === undefined) return null;
              // The caller only feeds reasoning/tool parts; branch by type
              // and narrow the union for each part component.
              return part.type === "reasoning" ? (
                <ReasoningPart part={part as ReasoningPartData} />
              ) : (
                <ToolPart part={part as ToolPartData} />
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};

export default ProcessFold;
