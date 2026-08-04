// L1 tests for the diff store (TASK-M4-07): per-server/session payload
// replacement with version bumps, refresh-only bumps and per-server resets.

import { afterEach, describe, expect, it } from "vitest";
import { applyDiff, bumpDiffVersion, diffs, getServerDiffState, resetServer } from "./diff.js";
import type { SnapshotFileDiff } from "../services/vcs.js";

const SERVER = "srv-diff-store";

function entry(file: string): SnapshotFileDiff {
  return {
    file,
    patch: `--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new\n`,
    additions: 1,
    deletions: 1,
    status: "modified",
  };
}

afterEach(() => {
  resetServer(SERVER);
});

describe("diff store", () => {
  it("applies a payload per (server, session) with a version bump", () => {
    applyDiff(SERVER, "ses_a", [entry("a.ts")]);
    expect(diffs[SERVER]["ses_a"]).toMatchObject({ version: 1 });
    expect(diffs[SERVER]["ses_a"].diffs).toEqual([entry("a.ts")]);

    applyDiff(SERVER, "ses_a", [entry("a.ts"), entry("b.ts")]);
    expect(diffs[SERVER]["ses_a"]).toMatchObject({ version: 2 });
    expect(diffs[SERVER]["ses_a"].diffs).toHaveLength(2);

    // Other sessions stay isolated.
    applyDiff(SERVER, "ses_b", []);
    expect(diffs[SERVER]["ses_b"]).toMatchObject({ version: 1, diffs: [] });
    expect(diffs[SERVER]["ses_a"]).toMatchObject({ version: 2 });
  });

  it("ignores non-array payloads", () => {
    applyDiff(SERVER, "ses_a", "nope" as unknown as SnapshotFileDiff[]);
    expect(diffs[SERVER]).toBeUndefined();
  });

  it("bumps the version without a payload for a known session only", () => {
    applyDiff(SERVER, "ses_a", [entry("a.ts")]);
    bumpDiffVersion(SERVER, "ses_a");
    expect(diffs[SERVER]["ses_a"]).toMatchObject({ version: 2, diffs: [entry("a.ts")] });

    // Unknown sessions stay untouched.
    bumpDiffVersion(SERVER, "ses_unknown");
    expect(diffs[SERVER]["ses_unknown"]).toBeUndefined();
  });

  it("resetServer clears the whole server bucket", () => {
    applyDiff(SERVER, "ses_a", [entry("a.ts")]);
    resetServer(SERVER);
    expect(diffs[SERVER]).toBeUndefined();
  });

  it("getServerDiffState reads a bucket non-reactively", () => {
    expect(getServerDiffState(SERVER, "ses_a")).toBeUndefined();
    applyDiff(SERVER, "ses_a", [entry("a.ts")]);
    expect(getServerDiffState(SERVER, "ses_a")).toMatchObject({ version: 1 });
  });
});
