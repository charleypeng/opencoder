// Internal OpenCode control messages use the public user-message shape so
// the session processor can resume after compaction. The UI must distinguish
// them from human prompts without changing the server-side control flow.

import type { Message, Part } from "../../stores/messages.js";

type PartsById = Record<string, Part>;

function allOwnedParts(
  partIds: readonly string[],
  parts: PartsById,
  predicate: (part: Part) => boolean,
): boolean {
  return (
    partIds.length > 0 &&
    partIds.every((id) => {
      const part = parts[id];
      return part !== undefined && predicate(part);
    })
  );
}

/** True for OpenCode's auto-compaction continuation prompt, not human input. */
export function isSyntheticContinuationMessage(
  info: Message | undefined,
  partIds: readonly string[],
  parts: PartsById,
): boolean {
  return (
    info?.role === "user" &&
    allOwnedParts(partIds, parts, (part) => part.type === "text" && part.synthetic === true)
  );
}

/** True for the user-shaped marker that starts an OpenCode context compaction. */
export function isCompactionMarkerMessage(
  info: Message | undefined,
  partIds: readonly string[],
  parts: PartsById,
): boolean {
  return (
    info?.role === "user" && allOwnedParts(partIds, parts, (part) => part.type === "compaction")
  );
}

/** True for the assistant-only summary generated while compacting context. */
export function isCompactionSummaryMessage(info: Message | undefined): boolean {
  return info?.role === "assistant" && info.mode === "compaction";
}

/** True when a record is internal state and must not occupy a chat row. */
export function isHiddenControlMessage(
  info: Message | undefined,
  partIds: readonly string[],
  parts: PartsById,
): boolean {
  return isSyntheticContinuationMessage(info, partIds, parts) || isCompactionSummaryMessage(info);
}
