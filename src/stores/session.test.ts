// L1 tests for the session store (TASK-M2-02): list replacement with
// recency ordering, upsert/remove, statuses in both schema-object and bare
// string forms, the status map from /session/status, active session and
// per-server reset.

import { afterEach, describe, expect, it } from "vitest";
import type { Session, SessionStatus } from "../services/session.js";
import {
  applySessionList,
  dismissSessionError,
  getServerSessionState,
  removeSession,
  resetServer,
  sessions,
  setActiveSession,
  setSessionStatus,
  setStatusMap,
  upsertSession,
} from "./session.js";

function session(id: string, updated: number): Session {
  return {
    id,
    slug: id,
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: id,
    version: "1.18.11",
    time: { created: updated, updated },
  } as Session;
}

const S1 = session("ses_1", 100);
const S2 = session("ses_2", 300);
const S3 = session("ses_3", 200);

afterEach(() => {
  resetServer("srv-ses");
  resetServer("srv-ses-b");
});

describe("session store", () => {
  it("starts with an empty bucket", () => {
    expect(getServerSessionState("srv-ses")).toEqual({
      sessions: {},
      order: [],
      statuses: {},
      activeSessionId: null,
    });
  });

  it("applySessionList replaces the list and orders most-recent first", () => {
    applySessionList("srv-ses", [S1, S2, S3]);
    expect(sessions["srv-ses"].order).toEqual(["ses_2", "ses_3", "ses_1"]);
    expect(sessions["srv-ses"].sessions["ses_2"]).toEqual(S2);

    // Replacing drops sessions that no longer exist on the server.
    applySessionList("srv-ses", [S1]);
    expect(sessions["srv-ses"].order).toEqual(["ses_1"]);
    expect("ses_2" in sessions["srv-ses"].sessions).toBe(false);
  });

  it("upsertSession adds new sessions and re-orders on update", () => {
    upsertSession("srv-ses", S1);
    upsertSession("srv-ses", S2);
    expect(sessions["srv-ses"].order).toEqual(["ses_2", "ses_1"]);

    upsertSession("srv-ses", { ...S1, time: { created: 100, updated: 500 } });
    expect(sessions["srv-ses"].order).toEqual(["ses_1", "ses_2"]);
    expect(sessions["srv-ses"].sessions["ses_1"].time.updated).toBe(500);
  });

  it("removeSession drops the session, its status and the active id", () => {
    applySessionList("srv-ses", [S1, S2]);
    setSessionStatus("srv-ses", "ses_1", "busy");
    setActiveSession("srv-ses", "ses_1");
    removeSession("srv-ses", "ses_1");
    expect("ses_1" in sessions["srv-ses"].sessions).toBe(false);
    expect(sessions["srv-ses"].order).toEqual(["ses_2"]);
    expect("ses_1" in sessions["srv-ses"].statuses).toBe(false);
    expect(sessions["srv-ses"].activeSessionId).toBeNull();
  });

  it("setSessionStatus accepts schema objects and bare strings", () => {
    setSessionStatus("srv-ses", "ses_1", { type: "busy" });
    setSessionStatus("srv-ses", "ses_2", "idle");
    expect(sessions["srv-ses"].statuses["ses_1"]).toEqual({ type: "busy" });
    expect(sessions["srv-ses"].statuses["ses_2"]).toEqual({ type: "idle" });
  });

  it("setStatusMap replaces the whole status map", () => {
    setSessionStatus("srv-ses", "ses_1", "busy");
    const map: Record<string, SessionStatus> = { ses_2: { type: "idle" } };
    setStatusMap("srv-ses", map);
    expect(sessions["srv-ses"].statuses).toEqual({ ses_2: { type: "idle" } });
  });

  it("dismissSessionError reverts an error status to idle", () => {
    setSessionStatus("srv-ses", "ses_1", { type: "error", message: "boom" });
    dismissSessionError("srv-ses", "ses_1");
    expect(sessions["srv-ses"].statuses["ses_1"]).toEqual({ type: "idle" });
  });

  it("dismissSessionError is a no-op for non-error statuses", () => {
    setSessionStatus("srv-ses", "ses_1", { type: "busy" });
    dismissSessionError("srv-ses", "ses_1");
    expect(sessions["srv-ses"].statuses["ses_1"]).toEqual({ type: "busy" });

    dismissSessionError("srv-ses", "ses_missing");
    expect("ses_missing" in sessions["srv-ses"].statuses).toBe(false);
  });

  it("setActiveSession sets and clears the viewed session", () => {
    setActiveSession("srv-ses", "ses_1");
    expect(sessions["srv-ses"].activeSessionId).toBe("ses_1");
    setActiveSession("srv-ses", null);
    expect(sessions["srv-ses"].activeSessionId).toBeNull();
  });

  it("keeps servers independent and resetServer clears only its own bucket", () => {
    applySessionList("srv-ses", [S1]);
    applySessionList("srv-ses-b", [S2]);
    resetServer("srv-ses");
    expect(sessions["srv-ses"]).toBeUndefined();
    expect(sessions["srv-ses-b"].order).toEqual(["ses_2"]);
  });
});
