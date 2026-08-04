// Shared prompt send path (TASK-M2-10): the optimistic-send flow extracted
// from PromptBox so the SessionErrorBanner's Retry action re-sends the last
// prompt through the identical pipeline. The user message is inserted into
// the messages store immediately (local-* ids, pending marker for the echo
// reconciliation), the per-server history records the prompt, and the
// POST /session/{id}/prompt_async round-trip happens in the background — on
// failure the optimistic message is rolled back and the classified error is
// returned (null on success). PromptBox owns the UI side of a send (clearing
// the textarea, the in-flight lock, the inline banner); callers are
// responsible for dropping the pending marker on unmount.

import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createSessionService, type PromptAsyncInput } from "../../services/session.js";
import type { Message, Part } from "../../stores/messages.js";
import {
  applyPartDelta,
  removePartsForMessage,
  trackPendingLocalMessage,
  untrackPendingLocalMessage,
  upsertMessage,
} from "../../stores/messages.js";
import { getServerSessionState } from "../../stores/session.js";
import { attachmentToPart, type Attachment } from "./attachments.js";
import { pushPrompt } from "./promptHistory.js";

/**
 * Sends a prompt through the full optimistic pipeline. Resolves to the
 * classified error when the POST fails (the optimistic message is rolled
 * back), or null when the round-trip succeeded. Attachments (TASK-M3-08)
 * are appended as FilePartInput parts after the text part; the optimistic
 * store insert and the prompt history only cover the text part — attachment
 * parts appear once the server echoes them. The optional agent name
 * (TASK-M5-04) rides in the prompt_async body so the server processes the
 * message with the selected agent (the optimistic message carries it too);
 * omitting it keeps the server-side default.
 */
export async function sendPrompt(
  serverId: string,
  sessionId: string,
  text: string,
  attachments: Attachment[] = [],
  agent?: string,
): Promise<ApiError | null> {
  const message = text.trim();
  if (message === "" && attachments.length === 0) return null;
  const now = Date.now();
  const session = getServerSessionState(serverId).sessions[sessionId];

  // Optimistic local insert so the bubble appears before the server echoes
  // it back through SSE (text-only: attachment parts surface with the echo,
  // TASK-M3-08); the tracked pending id lets the first real message.updated
  // roll this local message over onto the echo. The session's model uses
  // { id, providerID } while a user message expects { providerID, modelID },
  // so the fields are mapped.
  const localMessageId = `local-${now}`;
  const localPartId = `local-part-${now}`;
  if (message !== "") {
    const optimistic: Message = {
      id: localMessageId,
      sessionID: sessionId,
      role: "user",
      time: { created: now },
      agent: agent ?? session?.agent ?? "",
      model: {
        providerID: session?.model?.providerID ?? "",
        modelID: session?.model?.id ?? "",
      },
    };
    const part: Part = {
      id: localPartId,
      sessionID: sessionId,
      messageID: localMessageId,
      type: "text",
      text: message,
    };
    upsertMessage(serverId, sessionId, optimistic);
    applyPartDelta(serverId, sessionId, part);
    trackPendingLocalMessage(serverId, sessionId, localMessageId);
    pushPrompt(serverId, message);
  }

  try {
    const parts: NonNullable<PromptAsyncInput["parts"]> = [];
    if (message !== "") parts.push({ type: "text", text: message });
    for (const attachment of attachments) {
      parts.push(attachmentToPart(attachment));
    }
    await createSessionService(getApiClient()).promptAsync(sessionId, {
      parts,
      ...(agent === undefined ? {} : { agent }),
    });
    return null;
  } catch (err) {
    // Roll the optimistic message back; on success the SSE echo would
    // have reconciled it. The pending marker is dropped either way.
    removePartsForMessage(serverId, sessionId, localMessageId);
    untrackPendingLocalMessage(serverId, sessionId);
    return ApiError.fromUnknown(err);
  }
}
