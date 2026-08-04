// L1 tests for the session create/rename/delete/fork actions (TASK-M2-05 /
// TASK-M6-03): create enters the store and becomes the active session;
// rename and delete apply optimistically and roll back to the captured
// original when the service rejects, rethrowing an ApiError; fork opens the
// created child session.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/errors";
import type { Session, SessionService } from "../../services/session";
import {
  applySessionList,
  getServerSessionState,
  resetServer,
  setActiveSession,
} from "../../stores/session";
import {
  createSession,
  deleteSession,
  forkSession,
  renameSession,
  revertSession,
  shareSession,
  unshareSession,
  unrevertSession,
} from "./sessionActions";

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
const CHILD = { ...session("sess_3", "", 3000), parentID: "sess_1" };

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
    fork: vi.fn(),
    share: vi.fn(),
    unshare: vi.fn(),
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

describe("forkSession", () => {
  it("forks without a message point, enters the child and opens it", async () => {
    const service = fakeService({ fork: vi.fn().mockResolvedValue(CHILD) });

    const result = await forkSession(SERVER, "sess_1", undefined, service);

    expect(service.fork).toHaveBeenCalledWith("sess_1", undefined);
    expect(result).toBe(CHILD);
    const state = getServerSessionState(SERVER);
    expect(state.sessions["sess_3"]).toEqual(CHILD);
    expect(state.activeSessionId).toBe("sess_3");
  });

  it("forks from a message point and passes the messageID through", async () => {
    const service = fakeService({ fork: vi.fn().mockResolvedValue(CHILD) });

    await forkSession(SERVER, "sess_1", "msg_02", service);

    expect(service.fork).toHaveBeenCalledWith("sess_1", "msg_02");
    expect(getServerSessionState(SERVER).activeSessionId).toBe("sess_3");
  });

  it("throws ApiError and leaves the store untouched when the fork fails", async () => {
    const service = fakeService({
      fork: vi.fn().mockRejectedValue(new ApiError(404, "http", "missing", false)),
    });
    const before = getServerSessionState(SERVER);

    await expect(forkSession(SERVER, "sess_1", undefined, service)).rejects.toMatchObject({
      code: "http",
      status: 404,
    });

    expect(getServerSessionState(SERVER)).toEqual(before);
    expect(getServerSessionState(SERVER).activeSessionId).toBeNull();
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

describe("shareSession / unshareSession (TASK-M6-05)", () => {
  const SHARED = {
    ...ORIGINAL,
    time: { created: ORIGINAL.time.created, updated: 2000 },
    share: { url: "https://share.opencode.dev/s/sess_1" },
  } as Session;

  it("shares the session and replaces the stored one with the server state", async () => {
    const service = fakeService({ share: vi.fn().mockResolvedValue(SHARED) });

    const result = await shareSession(SERVER, "sess_1", service);

    expect(service.share).toHaveBeenCalledWith("sess_1");
    expect(result).toBe(SHARED);
    expect(getServerSessionState(SERVER).sessions["sess_1"].share).toEqual({
      url: "https://share.opencode.dev/s/sess_1",
    });
  });

  it("throws ApiError and leaves the store untouched when the share fails", async () => {
    const service = fakeService({
      share: vi.fn().mockRejectedValue(new ApiError(500, "http", "boom", true)),
    });
    const before = getServerSessionState(SERVER);

    await expect(shareSession(SERVER, "sess_1", service)).rejects.toMatchObject({
      code: "http",
      status: 500,
    });

    expect(getServerSessionState(SERVER)).toEqual(before);
  });

  it("unshares and clears the share marker in the store", async () => {
    applySessionList(SERVER, [SHARED]);
    const service = fakeService({ unshare: vi.fn().mockResolvedValue(ORIGINAL) });

    const result = await unshareSession(SERVER, "sess_1", service);

    expect(service.unshare).toHaveBeenCalledWith("sess_1");
    expect(result).toBe(ORIGINAL);
    expect(getServerSessionState(SERVER).sessions["sess_1"].share).toBeUndefined();
  });

  it("throws ApiError and keeps the share marker when the unshare fails", async () => {
    applySessionList(SERVER, [SHARED]);
    const service = fakeService({
      unshare: vi.fn().mockRejectedValue(new ApiError(500, "http", "boom", true)),
    });

    await expect(unshareSession(SERVER, "sess_1", service)).rejects.toMatchObject({
      code: "http",
    });

    expect(getServerSessionState(SERVER).sessions["sess_1"].share?.url).toBe(
      "https://share.opencode.dev/s/sess_1",
    );
  });
});

describe("revertSession / unrevertSession (TASK-M6-04)", () => {
  const REVERTED = {
    ...ORIGINAL,
    time: { created: ORIGINAL.time.created, updated: 2000 },
    revert: { messageID: "msg_02" },
  } as Session;

  it("reverts to the message and replaces the stored session with the server state", async () => {
    const service = fakeService({ revert: vi.fn().mockResolvedValue(REVERTED) });

    const result = await revertSession(SERVER, "sess_1", "msg_02", service);

    expect(service.revert).toHaveBeenCalledWith("sess_1", "msg_02");
    expect(result).toBe(REVERTED);
    expect(getServerSessionState(SERVER).sessions["sess_1"]).toEqual(REVERTED);
    expect(getServerSessionState(SERVER).activeSessionId).toBeNull();
  });

  it("throws ApiError and leaves the store untouched when the revert fails", async () => {
    const service = fakeService({
      revert: vi.fn().mockRejectedValue(new ApiError(400, "http", "unknown messageID", false)),
    });
    const before = getServerSessionState(SERVER);

    await expect(revertSession(SERVER, "sess_1", "msg_nope", service)).rejects.toMatchObject({
      code: "http",
      status: 400,
    });

    expect(service.revert).toHaveBeenCalledWith("sess_1", "msg_nope");
    expect(getServerSessionState(SERVER)).toEqual(before);
  });

  it("unreverts and clears the revert marker in the store", async () => {
    applySessionList(SERVER, [REVERTED]);
    const service = fakeService({ unrevert: vi.fn().mockResolvedValue(ORIGINAL) });

    const result = await unrevertSession(SERVER, "sess_1", service);

    expect(service.unrevert).toHaveBeenCalledWith("sess_1");
    expect(result).toBe(ORIGINAL);
    expect(getServerSessionState(SERVER).sessions["sess_1"].revert).toBeUndefined();
  });

  it("throws ApiError and keeps the revert marker when the unrevert fails", async () => {
    applySessionList(SERVER, [REVERTED]);
    const service = fakeService({
      unrevert: vi.fn().mockRejectedValue(new ApiError(500, "http", "boom", true)),
    });

    await expect(unrevertSession(SERVER, "sess_1", service)).rejects.toMatchObject({
      code: "http",
    });

    expect(getServerSessionState(SERVER).sessions["sess_1"].revert?.messageID).toBe("msg_02");
  });
});
