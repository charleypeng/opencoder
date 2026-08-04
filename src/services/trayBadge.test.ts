// L1 tests for the tray badge sync (TASK-M8-05): the pure pending-count
// helper sums every server's permission queue, and startTrayBadgeSync
// watches the live permission store and pushes the count to the tray
// facade, stopping on dispose.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pendingPermissionCount, startTrayBadgeSync } from "./trayBadge";
import {
  applyList,
  enqueue,
  permissions,
  resetServer as resetPermissions,
} from "../stores/permission.js";
import type { PermissionRequest } from "./permission.js";

const { setTrayBadgeMock } = vi.hoisted(() => ({ setTrayBadgeMock: vi.fn() }));
vi.mock("./tray.js", () => ({ setTrayBadge: setTrayBadgeMock }));

const SERVER_A = "srv-tray-a";
const SERVER_B = "srv-tray-b";

function request(id: string): PermissionRequest {
  return { id, sessionID: "s1", permission: "shell", patterns: [], metadata: {}, always: [] };
}

beforeEach(() => {
  resetPermissions(SERVER_A);
  resetPermissions(SERVER_B);
});

afterEach(() => {
  vi.clearAllMocks();
  resetPermissions(SERVER_A);
  resetPermissions(SERVER_B);
});

describe("pendingPermissionCount", () => {
  it("is zero for an empty store", () => {
    expect(pendingPermissionCount({})).toBe(0);
  });

  it("sums every server's queue length", () => {
    applyList(SERVER_A, [request("p1"), request("p2")]);
    enqueue(SERVER_B, request("p3"));
    expect(pendingPermissionCount(permissions)).toBe(3);
  });
});

describe("startTrayBadgeSync", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("pushes the pending count on mount and after queue changes", async () => {
    const dispose = startTrayBadgeSync();
    try {
      await flush();
      expect(setTrayBadgeMock).toHaveBeenCalledWith(0);
      enqueue(SERVER_A, request("p1"));
      enqueue(SERVER_A, request("p2"));
      await flush();
      expect(setTrayBadgeMock).toHaveBeenLastCalledWith(2);
      applyList(SERVER_B, [request("p3")]);
      await flush();
      expect(setTrayBadgeMock).toHaveBeenLastCalledWith(3);
    } finally {
      dispose();
    }
  });

  it("stops reacting after dispose", async () => {
    const dispose = startTrayBadgeSync();
    await flush();
    setTrayBadgeMock.mockClear();
    dispose();
    enqueue(SERVER_A, request("p1"));
    await flush();
    expect(setTrayBadgeMock).not.toHaveBeenCalled();
  });
});
