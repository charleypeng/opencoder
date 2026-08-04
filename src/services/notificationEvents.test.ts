// L1 tests for the notification event wiring (TASK-M8-06): the three
// pure mappings (busy/retry -> idle = completion, a queue gaining an id =
// pending item, the prefs + focus send gate) and the store watcher
// (startNotifications) that drives the notification facade from the live
// session/permission/question stores and stops on dispose.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generationCompleted,
  queueGainedItem,
  shouldNotify,
  startNotifications,
} from "./notificationEvents.js";
import {
  applySessionList,
  removeSession,
  resetServer as resetSessions,
  setSessionStatus,
} from "../stores/session.js";
import {
  enqueue as enqueuePermission,
  resetServer as resetPermissions,
} from "../stores/permission.js";
import { enqueue as enqueueQuestion, resetServer as resetQuestions } from "../stores/question.js";
import type { PermissionRequest } from "./permission.js";
import type { QuestionRequest } from "./question.js";
import type { Session } from "./session.js";

const { notifyMock, isWindowFocusedMock } = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  isWindowFocusedMock: vi.fn(),
}));
vi.mock("./notifications.js", () => ({
  notify: notifyMock,
  isWindowFocused: isWindowFocusedMock,
}));

const SERVER = "srv-notify";

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

function permissionRequest(id: string, sessionID = "s1"): PermissionRequest {
  return { id, sessionID, permission: "shell", patterns: [], metadata: {}, always: [] };
}

function questionRequest(id: string, sessionID = "s1"): QuestionRequest {
  return { id, sessionID, questions: [{ question: "Pick", header: "Pick", options: [] }] };
}

beforeEach(() => {
  resetSessions(SERVER);
  resetPermissions(SERVER);
  resetQuestions(SERVER);
  localStorage.removeItem("oc-notifications");
  isWindowFocusedMock.mockResolvedValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
  resetSessions(SERVER);
  resetPermissions(SERVER);
  resetQuestions(SERVER);
  localStorage.removeItem("oc-notifications");
});

describe("generationCompleted", () => {
  it("never fires on the first observation (no baseline)", () => {
    expect(generationCompleted(undefined, { type: "busy" })).toBe(false);
    expect(generationCompleted(undefined, { type: "idle" })).toBe(false);
  });

  it("fires when a generating session turns idle", () => {
    expect(generationCompleted({ type: "busy" }, { type: "idle" })).toBe(true);
    expect(
      generationCompleted(
        { type: "retry", attempt: 2, message: "retrying", next: 5 },
        { type: "idle" },
      ),
    ).toBe(true);
  });

  it("does not fire for non-completions", () => {
    expect(generationCompleted({ type: "busy" }, { type: "busy" })).toBe(false);
    expect(generationCompleted({ type: "idle" }, { type: "idle" })).toBe(false);
    expect(generationCompleted({ type: "idle" }, { type: "busy" })).toBe(false);
    expect(generationCompleted({ type: "error" }, { type: "idle" })).toBe(false);
  });
});

describe("queueGainedItem", () => {
  it("never fires on the first observation (no baseline)", () => {
    expect(queueGainedItem(undefined, ["p1"])).toBe(false);
  });

  it("fires when a new id joins the queue", () => {
    expect(queueGainedItem(["p1"], ["p1", "p2"])).toBe(true);
    expect(queueGainedItem([], ["p1"])).toBe(true);
  });

  it("does not fire when the queue only shrinks or reorders", () => {
    expect(queueGainedItem(["p1", "p2"], ["p1"])).toBe(false);
    expect(queueGainedItem(["p1", "p2"], ["p2", "p1"])).toBe(false);
    expect(queueGainedItem([], [])).toBe(false);
  });
});

describe("shouldNotify", () => {
  it("requires an unfocused window", () => {
    expect(shouldNotify(true, true, true)).toBe(false);
    expect(shouldNotify(false, true, true)).toBe(true);
  });

  it("requires the master switch", () => {
    expect(shouldNotify(false, false, true)).toBe(false);
    expect(shouldNotify(false, true, true)).toBe(true);
  });

  it("requires the per-server switch", () => {
    expect(shouldNotify(false, true, false)).toBe(false);
  });
});

describe("startNotifications", () => {
  // Effects created inside createRoot run on Solid's own flush; tests drive
  // the stores OUTSIDE the root callback (disposing inside the callback
  // cancels the scheduled runs) and await a tick before asserting so the
  // flush is deterministic. The watcher's OWN returned dispose is used —
  // disposing a wrapping root does not cancel the nested effects.
  function withWatcher(run: () => void): void {
    const dispose = startNotifications(SERVER);
    try {
      run();
    } finally {
      dispose();
    }
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("fires a completion notification when a generating session turns idle", async () => {
    withWatcher(() => {
      applySessionList(SERVER, [session("s1")]);
      setSessionStatus(SERVER, "s1", { type: "busy" });
      setSessionStatus(SERVER, "s1", { type: "idle" });
    });
    await flush();
    expect(notifyMock).toHaveBeenCalledWith({ title: "Generation complete", body: "Session s1" });
  });

  it("fires a permission notification when a request joins the queue", async () => {
    withWatcher(() => {
      applySessionList(SERVER, [session("s1")]);
      enqueuePermission(SERVER, permissionRequest("p1", "s1"));
    });
    await flush();
    expect(notifyMock).toHaveBeenCalledWith({ title: "Permission requested", body: "Session s1" });
  });

  it("fires a question notification when a request joins the queue", async () => {
    withWatcher(() => {
      applySessionList(SERVER, [session("s1")]);
      enqueueQuestion(SERVER, questionRequest("q1", "s1"));
    });
    await flush();
    expect(notifyMock).toHaveBeenCalledWith({ title: "Question asked", body: "Session s1" });
  });

  it("does not fire for the state already present at mount", async () => {
    applySessionList(SERVER, [session("s1")]);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    enqueuePermission(SERVER, permissionRequest("p1"));
    enqueueQuestion(SERVER, questionRequest("q1"));
    withWatcher(() => {});
    await flush();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("prunes deleted sessions so a reused id starts a fresh baseline", async () => {
    applySessionList(SERVER, [session("s1")]);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    const dispose = startNotifications(SERVER);
    try {
      removeSession(SERVER, "s1");
      await flush();
      applySessionList(SERVER, [session("s1")]);
      await flush();
      setSessionStatus(SERVER, "s1", { type: "idle" });
      await flush();
    } finally {
      dispose();
    }
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("respects the window-focus gate", async () => {
    isWindowFocusedMock.mockResolvedValue(true);
    withWatcher(() => {
      applySessionList(SERVER, [session("s1")]);
      setSessionStatus(SERVER, "s1", { type: "busy" });
      setSessionStatus(SERVER, "s1", { type: "idle" });
    });
    await flush();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("respects the do-not-disturb master switch", async () => {
    localStorage.setItem("oc-notifications", JSON.stringify({ enabled: false }));
    withWatcher(() => {
      applySessionList(SERVER, [session("s1")]);
      setSessionStatus(SERVER, "s1", { type: "busy" });
      setSessionStatus(SERVER, "s1", { type: "idle" });
    });
    await flush();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("respects the per-server switch", async () => {
    localStorage.setItem("oc-notifications", JSON.stringify({ perServer: { [SERVER]: false } }));
    withWatcher(() => {
      applySessionList(SERVER, [session("s1")]);
      setSessionStatus(SERVER, "s1", { type: "busy" });
      setSessionStatus(SERVER, "s1", { type: "idle" });
    });
    await flush();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("stops reacting after dispose", async () => {
    const dispose = startNotifications(SERVER);
    dispose();
    applySessionList(SERVER, [session("s1")]);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    setSessionStatus(SERVER, "s1", { type: "idle" });
    await flush();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
