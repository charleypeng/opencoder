// L2 tests for the message delete action (TASK-M3-06): optimistic per-
// message removal and rollback restoring info + parts at their original
// order position when the DELETE round-trip fails.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/errors.js";
import type { Message, Part } from "../../stores/messages.js";
import { applyPartDelta, messages, resetServer, upsertMessage } from "../../stores/messages.js";
import { deleteMessage } from "./deleteMessage.js";

const SERVER = "srv-actions";
const SESSION = "ses_actions_1";

function userMessage(id: string): Message {
  return {
    id,
    sessionID: SESSION,
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5" },
  } as Message;
}

function textPart(id: string, messageID: string, text: string): Part {
  return { id, sessionID: SESSION, messageID, type: "text", text } as Part;
}

function seedTranscript(): void {
  upsertMessage(SERVER, SESSION, userMessage("msg_user"));
  applyPartDelta(SERVER, SESSION, textPart("prt_1", "msg_user", "hello"));
  applyPartDelta(SERVER, SESSION, textPart("prt_2", "msg_asst", "reply a"));
  applyPartDelta(SERVER, SESSION, textPart("prt_3", "msg_asst", "reply b"));
  upsertMessage(SERVER, SESSION, {
    ...userMessage("msg_asst"),
    role: "assistant",
  } as Message);
}

afterEach(() => {
  resetServer(SERVER);
  vi.restoreAllMocks();
});

describe("deleteMessage", () => {
  it("removes the message optimistically and resolves on success", async () => {
    seedTranscript();
    const service = { remove: vi.fn().mockResolvedValue(true) };

    await deleteMessage(SERVER, SESSION, "msg_asst", service as never);

    expect(service.remove).toHaveBeenCalledWith(SESSION, "msg_asst");
    const entry = messages[SERVER][SESSION];
    expect(entry.order).toEqual(["prt_1"]);
    expect(entry.infos["msg_asst"]).toBeUndefined();
    expect(entry.messageParts["msg_asst"]).toBeUndefined();
  });

  it("rolls the message back at its original position on failure", async () => {
    seedTranscript();
    const service = { remove: vi.fn().mockRejectedValue({ status: 409, code: "http" }) };

    await expect(
      deleteMessage(SERVER, SESSION, "msg_asst", service as never),
    ).rejects.toBeInstanceOf(ApiError);

    const entry = messages[SERVER][SESSION];
    expect(entry.order).toEqual(["prt_1", "prt_2", "prt_3"]);
    expect((entry.parts["prt_2"] as { text?: string }).text).toBe("reply a");
    expect(entry.infos["msg_asst"].id).toBe("msg_asst");
  });

  it("restores the latest-message slot when the deleted message was the latest", async () => {
    seedTranscript();
    const service = { remove: vi.fn().mockRejectedValue(new Error("boom")) };

    await expect(deleteMessage(SERVER, SESSION, "msg_asst", service as never)).rejects.toBeTruthy();

    const entry = messages[SERVER][SESSION];
    expect(entry.info?.id).toBe("msg_asst");
  });
});
