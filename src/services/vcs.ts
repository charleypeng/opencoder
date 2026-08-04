// VCS domain service (TASK-M4-01): typed wrappers around the branch, status,
// diff and patch-apply endpoints, factory form per architecture §4.4. Errors
// pass through as ApiError from the client (no catching here).

import type { components, operations } from "./api/schema.js";
import { type ApiClient, type ApiPath, type RequestOptions } from "./client.js";

export type VcsInfo = components["schemas"]["VcsInfo"];
export type VcsFileStatus = components["schemas"]["VcsFileStatus"];
export type VcsFileDiff = components["schemas"]["VcsFileDiff"];
export type SnapshotFileDiff = components["schemas"]["SnapshotFileDiff"];
/** Request body of `POST /vcs/apply` ({ patch }). */
export type VcsApplyInput = NonNullable<
  operations["vcs.apply"]["requestBody"]
>["content"]["application/json"];

export type VcsDiffMode = "git" | "branch";

export interface VcsDiffOptions {
  /** Diff mode; the contract requires one, so "git" (working tree) is the default. */
  mode?: VcsDiffMode;
  /** Context lines per hunk. */
  context?: number;
  dir?: string;
}

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

function sessionDiffPath(sessionID: string): ApiPath {
  return `/session/${sessionID}/diff` as ApiPath;
}

export function createVcsService(client: ApiClient) {
  return {
    /** Branch information for the directory. */
    info: (dir?: string) => client.get<VcsInfo>("/vcs", dirQuery(dir)),
    /** Working-tree changes with per-file addition/deletion counts. */
    status: (dir?: string) => client.get<VcsFileStatus[]>("/vcs/status", dirQuery(dir)),
    /**
     * Per-file unified diffs. The 1.18.11 contract exposes `mode`/`context`
     * but no per-file `path` filter, so the M4-08 panel filters single files
     * from the returned array.
     */
    diff: (options: VcsDiffOptions = {}) =>
      client.get<VcsFileDiff[]>("/vcs/diff", {
        query: {
          mode: options.mode ?? "git",
          ...(options.context === undefined ? {} : { context: options.context }),
          ...(options.dir === undefined ? {} : { directory: options.dir }),
        },
      }),
    /**
     * Raw unified diff text for the whole working tree. The endpoint serves
     * text/x-diff (not JSON): a parsed string body wins, and bodyText covers
     * transports that only expose the raw (JSON-quoted) wire form.
     */
    diffRaw: async (dir?: string) => {
      const response = await client.request("GET", "/vcs/diff/raw", dirQuery(dir));
      return (typeof response.body === "string" ? response.body : response.bodyText) as string;
    },
    /** Apply a patch to the working tree; resolves to applied: true/false. */
    apply: (patch: string, dir?: string) =>
      client.post<{ applied: boolean }>("/vcs/apply", {
        body: { patch } satisfies VcsApplyInput,
        ...(dirQuery(dir) ?? {}),
      }),
    /** Diffs of a session, optionally limited to one message (M4-07). */
    sessionDiff: (sessionID: string, messageID?: string, dir?: string) => {
      const query: Record<string, string> = {};
      if (messageID !== undefined) query.messageID = messageID;
      if (dir !== undefined) query.directory = dir;
      return client.get<SnapshotFileDiff[]>(sessionDiffPath(sessionID), { query });
    },
  };
}

export type VcsService = ReturnType<typeof createVcsService>;
