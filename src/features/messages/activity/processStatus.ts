// Deterministic current-status derivation (PROCESS-REF-01): picks the single
// tail status shown for a run from observable parts only. The run's own
// active/ended state comes from the authoritative agent row, never from
// individual parts, so a historical reasoning part missing `time.end` cannot
// keep a finished run permanently "active".

import type { Part } from "../../../stores/messages.js";
import { deriveActivityTrace, type ActivityEntry } from "./deriveActivityTrace.js";

export type ProcessStatus =
  | { kind: "idle" }
  | { kind: "waiting-model" }
  | { kind: "waiting-user"; channel: "permission" | "question" }
  | { kind: "reasoning"; preview?: string }
  | { kind: "tool"; running: number; pending: number; tool?: string }
  | { kind: "retry"; message?: string };

export interface ProcessStatusOptions {
  /** Authoritative run activity from the agent row / session status. */
  active: boolean;
  /** True while the answer text itself is streaming: without other real
   *  activity the tail status stays quiet instead of claiming "thinking". */
  contentStreaming?: boolean;
  /** A pending permission/question request for this session — the run is
   *  blocked on the user, not on the model. */
  waitingUser?: "permission" | "question";
  /** Ticking clock shared with the elapsed header, so time-relative
   *  statuses stay in step with it. */
  now?: number;
}

const latestReasoning = (entries: ActivityEntry[]): ActivityEntry | undefined => {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.kind === "summary") return entry;
  }
  return undefined;
};

/** Maps observable parts to the one current status for a run. */
export function deriveProcessStatus(
  parts: Array<Part | undefined>,
  options: ProcessStatusOptions,
): ProcessStatus {
  if (!options.active) return { kind: "idle" };

  const entries = deriveActivityTrace(parts, options.now ?? Date.now(), "status");

  // A pending permission/question request means the run is blocked on the
  // user; that real wait outranks every synthetic progress claim.
  if (options.waitingUser !== undefined) {
    return { kind: "waiting-user", channel: options.waitingUser };
  }

  // A retry only describes the present while it is the latest observable
  // activity; once any tool, reasoning, or compaction follows it, the run
  // has moved on.
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.kind === "retry") return { kind: "retry", message: entry.preview };
    if (
      entry.kind === "tool" ||
      entry.kind === "command" ||
      entry.kind === "summary" ||
      entry.kind === "compaction"
    ) {
      break;
    }
  }

  const running = entries.filter((entry) => entry.kind !== "note" && entry.status === "active");
  const pendingTools = entries.filter(
    (entry) => entry.kind !== "note" && entry.status === "queued",
  );
  const activeTool = running.find((entry) => entry.kind === "tool" || entry.kind === "command");

  if (activeTool !== undefined) {
    return {
      kind: "tool",
      running: running.length,
      pending: pendingTools.length,
      tool: activeTool.title,
    };
  }
  if (pendingTools.length > 0) {
    const first = pendingTools[0];
    return {
      kind: "tool",
      running: 0,
      pending: pendingTools.length,
      tool: first.kind === "tool" || first.kind === "command" ? first.title : undefined,
    };
  }

  const reasoning = latestReasoning(entries);
  if (reasoning !== undefined && reasoning.status === "active") {
    return { kind: "reasoning", preview: reasoning.preview };
  }
  // Only the model-wait guess is left and the answer text is already arriving;
  // the run is visibly producing content, so the tail status stays quiet.
  if (options.contentStreaming === true) return { kind: "idle" };
  return { kind: "waiting-model" };
}
