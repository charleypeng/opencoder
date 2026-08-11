// L1 tests for automatic session titles (settings > config > global
// "AI generated title"): the default-title matcher, the first-message
// title derivation, and the watcher — enabled/disabled by the preference,
// firing once per session once a user AND an assistant message exist,
// PATCHing the derived title through the session service and upserting
// the server's updated session, and disposing cleanly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDefaultTitle,
  setAutoTitleEnabled,
  startAutoTitler,
  titleFromFirstMessage,
} from "./autoTitle";
import {
  type Message,
  type Part,
  type SessionMessages,
  applyPartDelta,
  resetServer as resetMessages,
  upsertMessage,
} from "../../stores/messages";
import {
  applySessionList,
  getServerSessionState,
  resetServer as resetSessions,
} from "../../stores/session";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-autotitle";
const SESSION_ID = "sess_titled";

function message(id: string, role: "user" | "assistant", created: number): Message {
  return {
    id,
    sessionID: SESSION_ID,
    role,
    time: { created },
  } as unknown as Message;
}

function textPart(id: string, text: string, messageID = "m1"): Part {
  return { id, sessionID: SESSION_ID, messageID, type: "text", text } as unknown as Part;
}

/** Seeds the reactive message table through the store's public API. */
function seedMessages(infos: Message[], parts: Part[] = []): void {
  for (const info of infos) upsertMessage(SERVER, SESSION_ID, info);
  for (const part of parts) applyPartDelta(SERVER, SESSION_ID, part);
}

const DEFAULT_TITLE = "New session - 2026-08-11T10:00:00.000Z";
const FORK_TITLE = "Child session - 2026-08-11T10:00:00.000Z";

function seedSession(title: string): void {
  applySessionList(SERVER, [
    {
      id: SESSION_ID,
      slug: "untitled",
      projectID: "p1",
      directory: "/mock/projects/opencode-demo",
      title,
      version: "1.18.11",
      time: { created: 1, updated: 1 },
    } as never,
  ]);
}

function buildEntry(infos: Message[], parts: Part[] = []): SessionMessages {
  const messageParts: Record<string, string[]> = {};
  const partTable: Record<string, Part> = {};
  for (const part of parts) {
    messageParts[part.messageID] = [...(messageParts[part.messageID] ?? []), part.id];
    partTable[part.id] = part;
  }
  return {
    info: null,
    infos: Object.fromEntries(infos.map((m) => [m.id, m])),
    parts: partTable,
    order: parts.map((part) => part.id),
    messageParts,
    lastDeltaAt: 1,
  };
}

describe("autoTitle helpers", () => {
  it("recognizes the server default titles only", () => {
    expect(isDefaultTitle(DEFAULT_TITLE)).toBe(true);
    expect(isDefaultTitle(FORK_TITLE)).toBe(true);
    expect(isDefaultTitle("My custom title")).toBe(false);
    expect(isDefaultTitle("")).toBe(false);
    expect(isDefaultTitle(undefined)).toBe(false);
    expect(isDefaultTitle("New session - not-a-timestamp")).toBe(false);
  });

  it("derives the title from the FIRST user message, single-lined and truncated", () => {
    const entry = buildEntry(
      [message("m1", "user", 1), message("m2", "assistant", 2), message("m3", "user", 3)],
      [textPart("p1", "Fix the  login  bug", "m1"), textPart("p3", "Second prompt", "m3")],
    );
    // The first user message's text wins, not the latest one.
    expect(titleFromFirstMessage(entry)).toBe("Fix the login bug");

    const long = buildEntry([message("m1", "user", 1)], [textPart("p1", "a".repeat(80))]);
    expect(titleFromFirstMessage(long)).toBe(`${"a".repeat(50)}…`);
  });

  it("returns undefined without a user message or without text", () => {
    const noUser = buildEntry([message("m2", "assistant", 2)]);
    expect(titleFromFirstMessage(noUser)).toBeUndefined();

    const noText = buildEntry([message("m1", "user", 1)]);
    expect(titleFromFirstMessage(noText)).toBeUndefined();
  });
});

describe("startAutoTitler", () => {
  let patchMock: ReturnType<typeof vi.fn>;

  function mockClient(): void {
    patchMock = vi.fn(async () => ({
      id: SESSION_ID,
      title: "patched",
      time: { created: 1, updated: 2 },
    }));
    getApiClientMock.mockReturnValue({ get: vi.fn(), patch: patchMock, post: vi.fn() });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setAutoTitleEnabled(true);
    resetMessages(SERVER);
    resetSessions(SERVER);
  });

  afterEach(() => {
    localStorage.clear();
    resetMessages(SERVER);
    resetSessions(SERVER);
  });

  it("renames a default-titled session after its first exchange completes", async () => {
    mockClient();
    seedSession(DEFAULT_TITLE);
    seedMessages(
      [message("m1", "user", 1), message("m2", "assistant", 2)],
      [textPart("p1", "Fix the login bug")],
    );

    const dispose = startAutoTitler(SERVER);
    await vi.waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith(
        "/session/sess_titled",
        expect.objectContaining({ body: { title: "Fix the login bug" } }),
      );
    });
    // The server's updated session replaces the stored one.
    await vi.waitFor(() => {
      expect(getServerSessionState(SERVER).sessions[SESSION_ID]?.title).toBe("patched");
    });
    dispose();
  });

  it("waits for the assistant reply before titling", async () => {
    mockClient();
    seedSession(DEFAULT_TITLE);
    seedMessages([message("m1", "user", 1)], [textPart("p1", "Fix the login bug")]);

    const dispose = startAutoTitler(SERVER);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(patchMock).not.toHaveBeenCalled();

    seedMessages([message("m2", "assistant", 2)]);
    await vi.waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    dispose();
  });

  it("skips sessions whose title is already custom", async () => {
    mockClient();
    seedSession("My custom title");
    seedMessages(
      [message("m1", "user", 1), message("m2", "assistant", 2)],
      [textPart("p1", "Fix the login bug")],
    );

    const dispose = startAutoTitler(SERVER);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(patchMock).not.toHaveBeenCalled();
    dispose();
  });

  it("does nothing while the preference is off", async () => {
    mockClient();
    setAutoTitleEnabled(false);
    seedSession(DEFAULT_TITLE);
    seedMessages(
      [message("m1", "user", 1), message("m2", "assistant", 2)],
      [textPart("p1", "Fix the login bug")],
    );

    const dispose = startAutoTitler(SERVER);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(patchMock).not.toHaveBeenCalled();
    dispose();
  });

  it("titles each session at most once", async () => {
    mockClient();
    seedSession(DEFAULT_TITLE);
    seedMessages(
      [message("m1", "user", 1), message("m2", "assistant", 2)],
      [textPart("p1", "Fix the login bug")],
    );

    const dispose = startAutoTitler(SERVER);
    await vi.waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    // Further message activity must not re-title the session.
    seedMessages([message("m3", "assistant", 3)], [textPart("p4", "more output")]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(patchMock).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("stops watching after dispose", async () => {
    mockClient();
    seedSession(DEFAULT_TITLE);
    const dispose = startAutoTitler(SERVER);
    dispose();

    seedMessages(
      [message("m1", "user", 1), message("m2", "assistant", 2)],
      [textPart("p1", "Fix the login bug")],
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(patchMock).not.toHaveBeenCalled();
  });
});
