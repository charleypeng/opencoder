// Message delete action (TASK-M3-06): optimistic per-message removal with
// rollback. The message's info, parts and their order position are captured
// BEFORE the store removal; when the DELETE round-trip fails, restoreMessage
// re-inserts everything at the recorded position so the transcript is
// visually unchanged. Errors surface as ApiError for the caller to display.
//
// Note: deletion is offered for user messages only (the menu hides it on
// assistant bubbles) — removing an assistant message would break the
// parentID chain the server maintains.

import { ApiError } from "../../services/errors";
import type { MessageService } from "../../services/message";
import type { Message, Part } from "../../stores/messages";
import { getServerMessages, removePartsForMessage, restoreMessage } from "../../stores/messages";

/** Deletes a message; optimistic with rollback restoring info + parts. */
export async function deleteMessage(
  serverId: string,
  sessionId: string,
  messageId: string,
  messageService: MessageService,
): Promise<void> {
  const snapshot = captureMessage(serverId, sessionId, messageId);
  removePartsForMessage(serverId, sessionId, messageId);
  try {
    await messageService.remove(sessionId, messageId);
  } catch (err) {
    if (snapshot !== undefined) {
      restoreMessage(serverId, sessionId, snapshot.info, snapshot.parts, snapshot.orderIndex);
    }
    throw ApiError.fromUnknown(err);
  }
}

interface MessageSnapshot {
  info: Message;
  /** The message's parts in render order. */
  parts: Part[];
  /** Order index of the message's first part before the removal. */
  orderIndex: number;
}

/** Captures everything restoreMessage needs to undo a removal. */
function captureMessage(
  serverId: string,
  sessionId: string,
  messageId: string,
): MessageSnapshot | undefined {
  const entry = getServerMessages(serverId)[sessionId];
  if (entry === undefined) return undefined;
  const info = entry.infos[messageId];
  if (info === undefined) return undefined;
  const parts = entry.order
    .map((id) => entry.parts[id])
    .filter((part): part is Part => part !== undefined && part.messageID === messageId);
  const orderIndex = Math.max(
    0,
    entry.order.findIndex((id) => entry.parts[id]?.messageID === messageId),
  );
  return { info, parts, orderIndex };
}
