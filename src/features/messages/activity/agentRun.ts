import type { SnapshotFileDiff } from "../../../services/vcs.js";
import type { Message, Part } from "../../../stores/messages.js";

export interface MessagePartGroup {
  messageID: string;
  partIds: string[];
}

export interface AgentRow {
  kind: "message" | "assistant-run" | "working";
  key: string;
  messageID: string;
  partIds: string[];
  activityPartIds: string[];
  allPartIds: string[];
  parentMessageID?: string;
  startedAt?: number;
  completedAt?: number;
  active: boolean;
}

export interface AgentRowOptions {
  busy: boolean;
  busySince?: number;
  sessionId: string;
}

interface PendingRun {
  parentMessageID?: string;
  groups: MessagePartGroup[];
}

const PROCESS_TYPES = new Set<Part["type"]>(["reasoning", "tool", "retry", "compaction"]);
const CONTENT_TYPES = new Set<Part["type"]>(["text", "file", "patch", "snapshot"]);
const EARLIER_CONTENT_TYPES = new Set<Part["type"]>(["file", "patch", "snapshot"]);
const COMMAND_TOOLS = /^(bash|shell|exec|terminal|command|run)/i;
const FILE_TOOLS = /^(edit|write|patch|apply_patch|multiedit|create|delete|move|rename)/i;

function assistantInfo(
  info: Message | undefined,
): Extract<Message, { role: "assistant" }> | undefined {
  return info?.role === "assistant" ? info : undefined;
}

function finishRun(
  run: PendingRun,
  infos: Record<string, Message>,
  parts: Record<string, Part>,
): AgentRow {
  const finalGroup = run.groups[run.groups.length - 1];
  const allPartIds = run.groups.flatMap((group) => group.partIds);
  const activityPartIds: string[] = [];
  const partIds: string[] = [];

  run.groups.forEach((group, groupIndex) => {
    const final = groupIndex === run.groups.length - 1;
    for (const partId of group.partIds) {
      const part = parts[partId];
      if (part === undefined) continue;
      if (PROCESS_TYPES.has(part.type) || (!final && part.type === "text")) {
        activityPartIds.push(partId);
      }
      if (
        (final && CONTENT_TYPES.has(part.type)) ||
        (!final && EARLIER_CONTENT_TYPES.has(part.type))
      ) {
        partIds.push(partId);
      }
    }
  });

  const timestamps = run.groups
    .map((group) => assistantInfo(infos[group.messageID])?.time.created)
    .filter((value): value is number => value !== undefined);
  const completions = run.groups
    .map((group) => assistantInfo(infos[group.messageID])?.time.completed)
    .filter((value): value is number => value !== undefined);

  const messageID = finalGroup?.messageID ?? run.groups[0]?.messageID ?? "assistant";
  const stableParent = run.parentMessageID ?? run.groups[0]?.messageID ?? messageID;
  return {
    kind: "assistant-run",
    key: `run:${stableParent}`,
    messageID,
    partIds,
    activityPartIds,
    allPartIds,
    parentMessageID: run.parentMessageID,
    startedAt: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
    completedAt: completions.length > 0 ? Math.max(...completions) : undefined,
    active: false,
  };
}

/** Groups one user turn's consecutive assistant messages into one agent run. */
export function deriveAgentRows(
  groups: MessagePartGroup[],
  infos: Record<string, Message>,
  parts: Record<string, Part>,
  options: AgentRowOptions,
): AgentRow[] {
  const rows: AgentRow[] = [];
  let pendingRun: PendingRun | undefined;
  let latestUserMessageID: string | undefined;

  const flushRun = () => {
    if (pendingRun === undefined) return;
    rows.push(finishRun(pendingRun, infos, parts));
    pendingRun = undefined;
  };

  for (const group of groups) {
    const info = infos[group.messageID];
    if (info?.role === "user") {
      flushRun();
      latestUserMessageID = group.messageID;
      rows.push({
        kind: "message",
        key: group.messageID,
        messageID: group.messageID,
        partIds: group.partIds,
        activityPartIds: [],
        allPartIds: group.partIds,
        active: false,
      });
      continue;
    }

    // The API requires assistant.parentID. If a part arrives before its
    // message envelope, keep that provisional assistant isolated until the
    // envelope supplies the real parent; guessing from the latest user turn
    // would merge legacy/incomplete messages and hide their action anchors.
    const parentMessageID = assistantInfo(info)?.parentID ?? group.messageID;
    if (pendingRun !== undefined && pendingRun.parentMessageID !== parentMessageID) flushRun();
    pendingRun ??= { parentMessageID, groups: [] };
    pendingRun.groups.push(group);
  }
  flushRun();

  if (!options.busy) return rows;

  const latest = rows[rows.length - 1];
  if (
    latest?.kind === "assistant-run" &&
    (latestUserMessageID === undefined || latest.parentMessageID === latestUserMessageID)
  ) {
    latest.active = true;
    latest.completedAt = undefined;
    latest.startedAt ??= options.busySince;
    return rows;
  }

  const parent = latestUserMessageID;
  const stableParent = parent ?? options.sessionId;
  rows.push({
    kind: "working",
    key: `working:${stableParent}`,
    messageID: `working:${stableParent}`,
    partIds: [],
    activityPartIds: [],
    allPartIds: [],
    parentMessageID: parent,
    startedAt: options.busySince,
    completedAt: undefined,
    active: true,
  });
  return rows;
}

export interface RunChangedFile {
  path: string;
  additions?: number;
  deletions?: number;
  status?: SnapshotFileDiff["status"];
}

export interface RunOutcome {
  files: RunChangedFile[];
  commands: string[];
  additions: number;
  deletions: number;
}

function inputString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function latestToolStates(
  parts: Array<Part | undefined>,
): Map<string, Extract<Part, { type: "tool" }>> {
  const latest = new Map<string, Extract<Part, { type: "tool" }>>();
  for (const part of parts) {
    if (part?.type !== "tool") continue;
    latest.set(part.callID, part);
  }
  return latest;
}

/** Extracts a compact, observable outcome from one completed agent run. */
export function deriveRunOutcome(
  parts: Array<Part | undefined>,
  diffs: SnapshotFileDiff[] = [],
): RunOutcome {
  const files = new Map<string, RunChangedFile>();
  const commands: string[] = [];
  const commandSet = new Set<string>();

  for (const diff of diffs) {
    if (diff.file === undefined || diff.file.trim() === "") continue;
    files.set(diff.file, {
      path: diff.file,
      additions: diff.additions,
      deletions: diff.deletions,
      ...(diff.status === undefined ? {} : { status: diff.status }),
    });
  }

  const latestTools = latestToolStates(parts);
  for (const part of parts) {
    if (part?.type === "patch") {
      for (const path of part.files) {
        if (path.trim() !== "" && !files.has(path)) files.set(path, { path });
      }
      continue;
    }
    if (part?.type !== "tool" || latestTools.get(part.callID) !== part) continue;
    if (part.state.status !== "completed" && part.state.status !== "error") continue;
    const input = part.state.input as Record<string, unknown>;
    if (COMMAND_TOOLS.test(part.tool)) {
      const command = inputString(input, ["command", "cmd"]);
      if (command !== undefined && !commandSet.has(command)) {
        commandSet.add(command);
        commands.push(command);
      }
    }
    if (part.state.status !== "completed" || !FILE_TOOLS.test(part.tool)) continue;
    const path = inputString(input, ["filePath", "file_path", "path", "filename"]);
    if (path !== undefined && !files.has(path)) files.set(path, { path });
  }

  const values = [...files.values()];
  return {
    files: values,
    commands,
    additions: values.reduce((total, file) => total + (file.additions ?? 0), 0),
    deletions: values.reduce((total, file) => total + (file.deletions ?? 0), 0),
  };
}
