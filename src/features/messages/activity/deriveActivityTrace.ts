// Activity Trace derivation (CHAT-TRACE-01): maps observable message parts
// to a stable, user-facing execution timeline. The mapper intentionally
// exposes summaries and operation results only; it never invents or derives
// hidden model reasoning.

import type { Part } from "../../../stores/messages.js";

export type ActivityKind = "summary" | "tool" | "command" | "compaction" | "retry" | "file-change";

export type ActivityPhase = "understand" | "decide" | "act" | "verify" | "attention";

export type ActivityStatus = "queued" | "active" | "complete" | "blocked" | "failed" | "cancelled";

export interface ActivityEntry {
  id: string;
  runKey: string;
  sourcePartId: string;
  timestamp: number;
  kind: ActivityKind;
  phase: ActivityPhase;
  status: ActivityStatus;
  title?: string;
  preview?: string;
  duration?: number;
  part: Part;
}

const COMMAND_TOOLS = /^(bash|shell|exec|terminal|command|run)/i;
const PREVIEW_LIMIT = 140;

function trimPreview(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (normalized === undefined || normalized === "") return undefined;
  return normalized.length > PREVIEW_LIMIT
    ? `${normalized.slice(0, PREVIEW_LIMIT - 1)}…`
    : normalized;
}

function firstLine(value: string | undefined): string | undefined {
  return trimPreview(value?.split("\n")[0]);
}

function toolStatus(status: Extract<Part, { type: "tool" }>["state"]["status"]): ActivityStatus {
  switch (status) {
    case "pending":
      return "queued";
    case "running":
      return "active";
    case "completed":
      return "complete";
    case "error":
      return "failed";
  }
}

function toolDuration(part: Extract<Part, { type: "tool" }>): number | undefined {
  if (part.state.status === "pending") return undefined;
  const end = part.state.status === "running" ? undefined : part.state.time.end;
  return end === undefined ? undefined : Math.max(0, end - part.state.time.start);
}

function toolPreview(part: Extract<Part, { type: "tool" }>): string | undefined {
  switch (part.state.status) {
    case "completed":
      return firstLine(part.state.output);
    case "error":
      return firstLine(part.state.error);
    case "pending":
      return firstLine(part.state.raw);
    case "running":
      return firstLine(part.state.title);
  }
}

function toEntry(
  part: Part,
  index: number,
  now: number,
  runKey: string,
): ActivityEntry | undefined {
  if (part.type === "reasoning") {
    const timestamp = part.time.start;
    const end = part.time.end;
    return {
      id: part.id,
      runKey,
      sourcePartId: part.id,
      timestamp,
      kind: "summary",
      phase: "decide",
      status: end === undefined ? "active" : "complete",
      preview: firstLine(part.text),
      duration: end === undefined ? Math.max(0, now - timestamp) : Math.max(0, end - timestamp),
      part,
    };
  }

  if (part.type === "tool") {
    const kind = COMMAND_TOOLS.test(part.tool) ? "command" : "tool";
    const timestamp = part.state.status === "pending" ? index : part.state.time.start;
    return {
      id: part.id,
      runKey,
      sourcePartId: part.id,
      timestamp,
      kind,
      phase: kind === "command" ? "verify" : "act",
      status: toolStatus(part.state.status),
      title: part.state.status === "completed" ? part.state.title : part.tool,
      preview: toolPreview(part),
      duration: toolDuration(part),
      part,
    };
  }

  if (part.type === "compaction") {
    return {
      id: part.id,
      runKey,
      sourcePartId: part.id,
      timestamp: index,
      kind: "compaction",
      phase: "attention",
      status: "complete",
      part,
    };
  }

  if (part.type === "retry") {
    return {
      id: part.id,
      runKey,
      sourcePartId: part.id,
      timestamp: part.time.created,
      kind: "retry",
      phase: "attention",
      status: "failed",
      preview: firstLine(part.error.data.message),
      part,
    };
  }

  return undefined;
}

/** Derives stable activity rows while preserving the source order. */
export function deriveActivityTrace(
  parts: Array<Part | undefined>,
  now = Date.now(),
  runKey = "run",
): ActivityEntry[] {
  return parts.flatMap((part, index) => {
    if (part === undefined) return [];
    const entry = toEntry(part, index, now, runKey);
    return entry === undefined ? [] : [entry];
  });
}
