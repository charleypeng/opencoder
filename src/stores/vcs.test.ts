// L1 tests for the VCS store (TASK-M4-08): branch info and status snapshots
// are applied without version bumps, a `vcs.branch.updated` event sets the
// branch AND bumps the version (mounted panels refetch status), the manual
// refresh bumps the version only when a bucket exists, and resetServer
// clears per-server state without touching other servers.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyBranch,
  applyStatus,
  applyVcs,
  getServerVcsState,
  refresh,
  resetServer,
  vcs,
} from "./vcs.js";
import type { VcsFileStatus, VcsInfo } from "../services/vcs.js";

const SERVER_A = "srv-vcs-a";
const SERVER_B = "srv-vcs-b";

const CHANGES: VcsFileStatus[] = [
  { file: "src/a.ts", additions: 12, deletions: 4, status: "modified" },
  { file: "src/b.ts", additions: 64, deletions: 0, status: "added" },
];

beforeEach(() => {
  resetServer(SERVER_A);
  resetServer(SERVER_B);
});

afterEach(() => {
  resetServer(SERVER_A);
  resetServer(SERVER_B);
});

describe("applyVcs / applyStatus", () => {
  it("stores the branch from GET /vcs without bumping the version", () => {
    applyVcs(SERVER_A, { branch: "main", default_branch: "main" } satisfies VcsInfo);
    expect(vcs[SERVER_A]).toEqual({ branch: "main", changes: [], version: 0 });
  });

  it("marks a missing or empty branch as a non-git workspace", () => {
    applyVcs(SERVER_A, {});
    expect(vcs[SERVER_A]?.branch).toBeNull();
    applyVcs(SERVER_B, { branch: "" });
    expect(vcs[SERVER_B]?.branch).toBeNull();
  });

  it("tolerates an undefined / null info payload", () => {
    applyVcs(SERVER_A, undefined);
    applyVcs(SERVER_B, null);
    expect(vcs[SERVER_A]?.branch).toBeNull();
    expect(vcs[SERVER_B]?.branch).toBeNull();
  });

  it("replaces the change list as a snapshot without a version bump", () => {
    applyVcs(SERVER_A, { branch: "main" });
    applyStatus(SERVER_A, CHANGES);
    expect(vcs[SERVER_A]?.changes).toEqual(CHANGES);
    expect(vcs[SERVER_A]?.version).toBe(0);

    const refreshed = [CHANGES[0]];
    applyStatus(SERVER_A, refreshed);
    expect(vcs[SERVER_A]?.changes).toEqual(refreshed);
    expect(vcs[SERVER_A]?.version).toBe(0);
  });

  it("ignores a non-array status payload", () => {
    applyVcs(SERVER_A, { branch: "main" });
    applyStatus(SERVER_A, undefined as unknown as VcsFileStatus[]);
    expect(vcs[SERVER_A]?.changes).toEqual([]);
  });
});

describe("applyBranch", () => {
  it("sets the branch and bumps the version for a mounted-panel refetch", () => {
    applyVcs(SERVER_A, { branch: "main" });
    applyStatus(SERVER_A, CHANGES);
    applyBranch(SERVER_A, "feature/x");
    expect(vcs[SERVER_A]).toEqual({
      branch: "feature/x",
      changes: CHANGES,
      version: 1,
    });
  });

  it("creates a bucket when the server has no VCS state yet", () => {
    applyBranch(SERVER_A, "feat/new");
    expect(vcs[SERVER_A]).toEqual({ branch: "feat/new", changes: [], version: 1 });
  });

  it("ignores non-string / empty branch payloads", () => {
    applyVcs(SERVER_A, { branch: "main" });
    applyBranch(SERVER_A, "");
    applyBranch(SERVER_A, 42 as unknown as string);
    expect(vcs[SERVER_A]?.branch).toBe("main");
    expect(vcs[SERVER_A]?.version).toBe(0);
  });
});

describe("refresh / resetServer", () => {
  it("bumps the version only for servers with an existing bucket", () => {
    applyVcs(SERVER_A, { branch: "main" });
    refresh(SERVER_A);
    expect(vcs[SERVER_A]?.version).toBe(1);

    refresh(SERVER_B);
    expect(vcs[SERVER_B]).toBeUndefined();
  });

  it("clears one server's state and leaves other servers untouched", () => {
    applyVcs(SERVER_A, { branch: "main" });
    applyVcs(SERVER_B, { branch: "dev" });
    resetServer(SERVER_A);
    expect(vcs[SERVER_A]).toBeUndefined();
    expect(vcs[SERVER_B]?.branch).toBe("dev");
  });

  it("exposes the non-reactive bucket reader", () => {
    applyVcs(SERVER_A, { branch: "main" });
    expect(getServerVcsState(SERVER_A)?.branch).toBe("main");
    expect(getServerVcsState(SERVER_B)).toBeUndefined();
  });
});
