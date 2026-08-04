// L1 tests for the session create/rename/delete actions (TASK-M2-05):
// create enters the store and becomes the active session; rename and
// delete apply optimistically and roll back to the captured original when
// the service rejects, rethrowing an ApiError.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/errors";
import type { Session, SessionService } from "../../services/session";
import {
  applySessionList,
  getServerSessionState,
  resetServer,
  setActiveSession,
} from "../../stores/session";
import { createSession, deleteSession, renameSession } from "./sessionActions";

const SERVER = "srv-actions";

function session(id: string, title: string, updated = 1000): Session {
  return {
    id,
    slug: `slug-${id}`,
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title,
    version: "1.18.11",
    time: { created: updated, updated },
  } as Session;
}

const ORIGINAL = session("sess_1", "Old title");
const RENAMED = session("sess_1", "New title");
const CREATED = session("sess_2", "", 2000);

/** A SessionService stub with vi.fn create/update/remove and silent rest. */
function fakeService(overrides: Partial<SessionService> = {}): SessionService {
  return {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    statusAll: vi.fn(),
    promptAsync: vi.fn(),
    abort: vi.fn(),
    ...overrides,
  } as SessionService;
}

beforeEach(() => {
  applySessionList(SERVER, [ORIGINAL]);
});

afterEach(() => {
  resetServer(SERVER);
});

describe("createSession", () => {
  it("creates an empty session, enters the store and makes it active", async () => {
    const service = fakeService({ create: vi.fn().mockResolvedValue(CREATED) });

    const result = await createSession(SERVER, service);

    expect(service.create).toHaveBeenCalledWith({ title: undefined });
    expect(result).toBe(CREATED);
    const state = getServerSessionState(SERVER);
    expect(state.sessions["sess_2"]).toEqual(CREATED);
    expect(state.order).toContain("sess_2");
    expect(state.activeSessionId).toBe("sess_2");
  });

  it("throws ApiError and leaves the store untouched when creation fails", async () => {
    const service = fakeService({
      create: vi.fn().mockRejectedValue(new ApiError(500, "http", "boom", true)),
    });
    const before = getServerSessionState(SERVER);

    await expect(createSession(SERVER, service)).rejects.toMatchObject({
      code: "http",
      status: 500,
    });

    expect(getServerSessionState(SERVER)).toEqual(before);
    expect(getServerSessionState(SERVER).activeSessionId).toBeNull();
  });

  it("normalizes unknown rejections to ApiError", async () => {
    const service = fakeService({ create: vi.fn().mockRejectedValue(new Error("network")) });

    await expect(createSession(SERVER, service)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("renameSession", () => {
  it("applies the new title optimistically and keeps it on success", async () => {
    const service = fakeService({ update: vi.fn().mockResolvedValue(RENAMED) });

    await renameSession(SERVER, "sess_1", "New title", service);

    expect(service.update).toHaveBeenCalledWith("sess_1", { title: "New title" });
    expect(getServerSessionState(SERVER).sessions["sess_1"]).toMatchObject({ title: "New title" });
  });

  it("rolls the title back and throws when the update fails", async () => {
    const service = fakeService({
      update: vi.fn().mockRejectedValue(new ApiError(500, "http", "boom", true)),
    });

    await expect(renameSession(SERVER, "sess_1", "New title", service)).rejects.toMatchObject({
      code: "http",
    });

    expect(getServerSessionState(SERVER).sessions["sess_1"]).toMatchObject({ title: "Old title" });
  });

  it("throws a not-found ApiError when the session is not in the store", async () => {
    const service = fakeService();

    await expect(renameSession(SERVER, "sess_missing", "x", service)).rejects.toMatchObject({
      code: "unknown",
    });
    expect(service.update).not.toHaveBeenCalled();
  });
});

describe("deleteSession", () => {
  it("removes the session optimistically and clears the active id", async () => {
    setActiveSession(SERVER, "sess_1");
    const service = fakeService({ remove: vi.fn().mockResolvedValue(true) });

    await deleteSession(SERVER, "sess_1", service);

    expect(service.remove).toHaveBeenCalledWith("sess_1");
    const state = getServerSessionState(SERVER);
    expect(state.sessions["sess_1"]).toBeUndefined();
    expect(state.order).not.toContain("sess_1");
    expect(state.activeSessionId).toBeNull();
  });

  it("re-inserts the session and throws when the delete fails", async () => {
    const service = fakeService({
      remove: vi.fn().mockRejectedValue(new ApiError(500, "http", "boom", true)),
    });

    await expect(deleteSession(SERVER, "sess_1", service)).rejects.toMatchObject({ code: "http" });

    expect(getServerSessionState(SERVER).sessions["sess_1"]).toEqual(ORIGINAL);
    expect(getServerSessionState(SERVER).order).toContain("sess_1");
  });

  it("restores the active id when deleting the active session fails", async () => {
    setActiveSession(SERVER, "sess_1");
    const service = fakeService({
      remove: vi.fn().mockRejectedValue(new ApiError(500, "http", "boom", true)),
    });

    await expect(deleteSession(SERVER, "sess_1", service)).rejects.toMatchObject({ code: "http" });

    const state = getServerSessionState(SERVER);
    expect(state.sessions["sess_1"]).toEqual(ORIGINAL);
    expect(state.order).toContain("sess_1");
    expect(state.activeSessionId).toBe("sess_1");
  });

  it("throws a not-found ApiError when the session is not in the store", async () => {
    const service = fakeService();

    await expect(deleteSession(SERVER, "sess_missing", service)).rejects.toMatchObject({
      code: "unknown",
    });
    expect(service.remove).not.toHaveBeenCalled();
  });
});
