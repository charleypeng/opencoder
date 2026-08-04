// L1 tests for the permission store (TASK-M5-01): enqueue appends and
// dedupes by id, dequeue removes only the targeted request, applyList
// replaces the queue wholesale, resetServer clears the bucket, and every
// change bumps the version while per-server buckets stay isolated.

import { afterEach, describe, expect, it } from "vitest";
import { applyList, dequeue, enqueue, permissions, resetServer } from "./permission.js";
import type { PermissionRequest } from "../services/permission.js";

const SERVER = "srv-perm";
const OTHER = "srv-other";

function request(id: string, permission = "bash", patterns: string[] = []): PermissionRequest {
  return { id, sessionID: "ses_1", permission, patterns, metadata: {}, always: [] };
}

afterEach(() => {
  resetServer(SERVER);
  resetServer(OTHER);
});

describe("permission store", () => {
  it("enqueue appends the request and bumps the version", () => {
    enqueue(SERVER, request("per_1"));
    expect(permissions[SERVER].queue).toEqual([request("per_1")]);
    expect(permissions[SERVER].version).toBe(1);

    enqueue(SERVER, request("per_2", "edit", ["src/a.ts"]));
    expect(permissions[SERVER].queue.map((r) => r.id)).toEqual(["per_1", "per_2"]);
    expect(permissions[SERVER].version).toBe(2);
  });

  it("enqueue ignores duplicate ids (idempotent)", () => {
    enqueue(SERVER, request("per_1"));
    enqueue(SERVER, request("per_1", "edit", ["src/a.ts"]));
    expect(permissions[SERVER].queue).toEqual([request("per_1")]);
    expect(permissions[SERVER].version).toBe(1);
  });

  it("enqueue ignores malformed requests", () => {
    enqueue(SERVER, null as unknown as PermissionRequest);
    enqueue(SERVER, { permission: "bash", patterns: [] } as unknown as PermissionRequest);
    expect(permissions[SERVER]).toBeUndefined();
  });

  it("dequeue removes the request and advances the queue head", () => {
    enqueue(SERVER, request("per_1"));
    enqueue(SERVER, request("per_2"));
    dequeue(SERVER, "per_1");
    expect(permissions[SERVER].queue).toEqual([request("per_2")]);
    expect(permissions[SERVER].version).toBe(3);
  });

  it("dequeue of an unknown id is a no-op (no version bump)", () => {
    enqueue(SERVER, request("per_1"));
    const version = permissions[SERVER].version;
    dequeue(SERVER, "per_nope");
    expect(permissions[SERVER].queue.map((r) => r.id)).toEqual(["per_1"]);
    expect(permissions[SERVER].version).toBe(version);
    dequeue(SERVER, 7 as unknown as string);
    expect(permissions[SERVER].version).toBe(version);
  });

  it("applyList replaces the whole queue", () => {
    enqueue(SERVER, request("per_1"));
    applyList(SERVER, [request("per_a", "bash", ["git status"]), request("per_b", "edit")]);
    expect(permissions[SERVER].queue.map((r) => r.id)).toEqual(["per_a", "per_b"]);
    applyList(SERVER, []);
    expect(permissions[SERVER].queue).toEqual([]);
  });

  it("applyList ignores non-array payloads", () => {
    enqueue(SERVER, request("per_1"));
    applyList(SERVER, null as unknown as PermissionRequest[]);
    expect(permissions[SERVER].queue.map((r) => r.id)).toEqual(["per_1"]);
  });

  it("resetServer clears the bucket entirely", () => {
    enqueue(SERVER, request("per_1"));
    resetServer(SERVER);
    expect(permissions[SERVER]).toBeUndefined();
  });

  it("keeps per-server buckets isolated", () => {
    enqueue(SERVER, request("per_1"));
    enqueue(OTHER, request("per_x"));
    expect(permissions[SERVER].queue.map((r) => r.id)).toEqual(["per_1"]);
    expect(permissions[OTHER].queue.map((r) => r.id)).toEqual(["per_x"]);
    dequeue(SERVER, "per_1");
    expect(permissions[OTHER].queue.map((r) => r.id)).toEqual(["per_x"]);
  });
});
