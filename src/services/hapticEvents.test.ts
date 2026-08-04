// L1 tests for the haptic events wiring (TASK-M7-07): the two pure
// transition mappings (session status busy/retry -> idle = "complete",
// any -> error = "error", first observation never fires; a permission
// queue gaining an id = "permission", first observation never fires) and
// the store watcher (startHapticEvents) that drives the haptic facade
// from the live session/permission stores and stops on dispose.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionHaptic, startHapticEvents, statusHaptic } from "./hapticEvents";
import {
  applySessionList,
  resetServer as resetSessions,
  setSessionStatus,
} from "../stores/session.js";
import { applyList, enqueue, resetServer as resetPermissions } from "../stores/permission.js";
import type { PermissionRequest } from "./permission.js";
import type { Session } from "./session.js";

const { hapticMock } = vi.hoisted(() => ({ hapticMock: vi.fn() }));
vi.mock("./haptics.js", () => ({ haptic: hapticMock }));

const SERVER = "srv-haptics";

function session(id: string): Session {
  return {
    id,
    slug: `slug-${id}`,
    projectID: "p",
    directory: "/d",
    title: `Session ${id}`,
    agent: "build",
    model: { id: "m", providerID: "p" },
    version: "1.18.11",
    time: { created: 1, updated: 1 },
  } as Session;
}

function request(id: string): PermissionRequest {
  return { id, sessionID: "s1", permission: "shell", patterns: [], metadata: {}, always: [] };
}

beforeEach(() => {
  resetSessions(SERVER);
  resetPermissions(SERVER);
});

afterEach(() => {
  vi.clearAllMocks();
  resetSessions(SERVER);
  resetPermissions(SERVER);
});

describe("statusHaptic", () => {
  it("never fires on the first observation (no baseline)", () => {
    expect(statusHaptic(undefined, { type: "busy" })).toBeNull();
    expect(statusHaptic(undefined, { type: "error" })).toBeNull();
  });

  it("fires complete when a generating session turns idle", () => {
    expect(statusHaptic({ type: "busy" }, { type: "idle" })).toBe("complete");
    expect(
      statusHaptic({ type: "retry", attempt: 2, message: "retrying", next: 5 }, { type: "idle" }),
    ).toBe("complete");
  });

  it("does not fire for non-completions", () => {
    expect(statusHaptic({ type: "busy" }, { type: "busy" })).toBeNull();
    expect(statusHaptic({ type: "idle" }, { type: "idle" })).toBeNull();
    expect(statusHaptic({ type: "idle" }, { type: "busy" })).toBeNull();
    expect(statusHaptic({ type: "error" }, { type: "idle" })).toBeNull();
  });

  it("fires error when the session errors", () => {
    expect(statusHaptic({ type: "busy" }, { type: "error", message: "boom" })).toBe("error");
    expect(statusHaptic({ type: "idle" }, { type: "error" })).toBe("error");
  });
});

describe("permissionHaptic", () => {
  it("never fires on the first observation (no baseline)", () => {
    expect(permissionHaptic(undefined, ["p1"])).toBeNull();
  });

  it("fires permission when a new request joins the queue", () => {
    expect(permissionHaptic(["p1"], ["p1", "p2"])).toBe("permission");
    expect(permissionHaptic([], ["p1"])).toBe("permission");
  });

  it("does not fire when the queue only shrinks or reorders", () => {
    expect(permissionHaptic(["p1", "p2"], ["p1"])).toBeNull();
    expect(permissionHaptic(["p1", "p2"], ["p2", "p1"])).toBeNull();
    expect(permissionHaptic([], [])).toBeNull();
  });
});

describe("startHapticEvents", () => {
  // Effects created inside createRoot run on Solid's own flush; tests drive
  // the stores OUTSIDE the root callback (disposing inside the callback
  // cancels the scheduled runs) and await a tick before asserting so the
  // flush is deterministic. The watcher's OWN returned dispose is used —
  // disposing a wrapping root does not cancel the nested effects.
  function withWatcher(run: () => void): void {
    const dispose = startHapticEvents(SERVER);
    try {
      run();
    } finally {
      dispose();
    }
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("fires complete when a generating session turns idle", async () => {
    withWatcher(() => {
      applySessionList(SERVER, [session("s1")]);
      setSessionStatus(SERVER, "s1", { type: "busy" });
      setSessionStatus(SERVER, "s1", { type: "idle" });
    });
    await flush();
    expect(hapticMock).toHaveBeenCalledWith("complete");
  });

  it("fires error on a session error", async () => {
    withWatcher(() => {
      applySessionList(SERVER, [session("s1")]);
      setSessionStatus(SERVER, "s1", { type: "busy" });
      setSessionStatus(SERVER, "s1", { type: "error", message: "boom" });
    });
    await flush();
    expect(hapticMock).toHaveBeenCalledWith("error");
  });

  it("fires permission when a request joins the queue and nothing on drain", async () => {
    withWatcher(() => {
      enqueue(SERVER, request("p1"));
    });
    await flush();
    expect(hapticMock).toHaveBeenCalledWith("permission");
    expect(hapticMock).toHaveBeenCalledTimes(1);
  });

  it("does not fire for the state already present at mount", async () => {
    // The mount snapshot (a generating session, a pending permission) is
    // captured synchronously as the baseline — never an event.
    applySessionList(SERVER, [session("s1")]);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    applyList(SERVER, [request("p1")]);
    withWatcher(() => {});
    await flush();
    expect(hapticMock).not.toHaveBeenCalled();
  });

  it("stops reacting after dispose", async () => {
    const dispose = startHapticEvents(SERVER);
    dispose();
    applySessionList(SERVER, [session("s1")]);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    setSessionStatus(SERVER, "s1", { type: "idle" });
    await flush();
    expect(hapticMock).not.toHaveBeenCalled();
  });
});
