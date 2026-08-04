// Shared shell send path (TASK-M5-08): the `!`-prefixed entry in the
// composer. Unlike sendPrompt there is no optimistic insert — POST
// /session/{id}/shell is synchronous and answers with the created
// assistant message ({ info, parts }), which is applied to the messages
// store directly in one batch pass. The caller restores the input text on
// failure (the message bubble never existed, so there is nothing to roll
// back); `!` entries are intentionally NOT recorded in the prompt history
// (same as slash commands). `shellCommandOf` is the pure router: a leading
// `!` with a non-empty command after it routes to /shell, anything else
// (including a bare `!`) falls back to the plain prompt path.

import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createSessionService } from "../../services/session.js";
import { applyMessageBatch, type MessageBatchItem } from "../../stores/messages.js";

/**
 * Extracts the command text of a `!` entry ("!ls -la" -> "ls -la");
 * null for non-`!` messages and for a bare `!` (plain prompt fallback).
 */
export function shellCommandOf(message: string): string | null {
  if (!message.startsWith("!")) return null;
  const command = message.slice(1).trim();
  return command === "" ? null : command;
}

/**
 * Runs a `!` shell command through POST /session/{id}/shell with the
 * session's effective agent (required by the contract) and model. The
 * returned { info, parts } message is applied to the store like any
 * assistant message. Resolves to the classified error on failure (null on
 * success); the caller surfaces it and restores the submitted text.
 */
export async function runShell(
  serverId: string,
  sessionId: string,
  command: string,
  agent: string,
  model?: { providerID: string; modelID: string },
): Promise<ApiError | null> {
  try {
    const result = await createSessionService(getApiClient()).shell(sessionId, {
      command,
      agent,
      ...(model === undefined ? {} : { model }),
    });
    const items: MessageBatchItem[] = [{ type: "message", info: result.info }];
    for (const part of result.parts) items.push({ type: "part", part });
    applyMessageBatch(serverId, sessionId, items);
    return null;
  } catch (err) {
    return ApiError.fromUnknown(err);
  }
}
