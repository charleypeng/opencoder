// Message delete action (TASK-M3-06): the DELETE round-trip runs BEFORE the
// store removal, so the message row stays mounted while the request is in
// flight. An optimistic removal would unmount the row (and with it the
// caller's confirmation dialog) while the request is pending, silently
// dropping the failure path — with the store untouched until the server
// confirms, a failed DELETE simply leaves the transcript as it was and the
// still-open dialog can show the inline error. Errors surface as ApiError
// for the caller to display.
//
// Note: deletion is offered for user messages only (the menu hides it on
// assistant bubbles) — removing an assistant message would break the
// parentID chain the server maintains.

import { ApiError } from "../../services/errors";
import type { MessageService } from "../../services/message";
import { removePartsForMessage } from "../../stores/messages";

/** Deletes a message: server DELETE first, store removal only on success. */
export async function deleteMessage(
  serverId: string,
  sessionId: string,
  messageId: string,
  messageService: MessageService,
): Promise<void> {
  try {
    await messageService.remove(sessionId, messageId);
  } catch (err) {
    throw ApiError.fromUnknown(err);
  }
  removePartsForMessage(serverId, sessionId, messageId);
}
