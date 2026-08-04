// File domain service (TASK-M4-01): typed wrappers around the file tree,
// content and status endpoints, factory form per architecture §4.4. Errors
// pass through as ApiError from the client (no catching here).

import type { components } from "./api/schema.js";
import { type ApiClient, type RequestOptions } from "./client.js";

export type FileNode = components["schemas"]["FileNode"];
export type FileContent = components["schemas"]["FileContent"];
// `/file/status` entry; aliased to avoid shadowing the DOM `File` type.
export type FileStatusEntry = components["schemas"]["File"];

// Large file strategy: the 1.18.11 FileContent schema carries no size or
// truncation metadata, so the client cannot detect >1MB payloads from the
// response and streaming/segmentation would need a server-side range/offset
// contract. The viewer (M4-03) renders `content` as-is; binary files arrive
// base64-encoded (`encoding: "base64"`). Revisit when a size/offset field
// lands in the contract.

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

export function createFileService(client: ApiClient) {
  return {
    /**
     * List files and directories of the workspace (flat FileNode list); an
     * optional `path` limits the listing to a subtree (directory expansion
     * for the M4-02 tree).
     */
    tree: (path?: string, dir?: string) =>
      client.get<FileNode[]>("/file", {
        query: {
          ...(path === undefined ? {} : { path }),
          ...(dir === undefined ? {} : { directory: dir }),
        },
      }),
    /** Read a file's content (text, or binary with base64 `encoding`). */
    content: (path: string, dir?: string) =>
      client.get<FileContent>("/file/content", {
        query: {
          path,
          ...(dir === undefined ? {} : { directory: dir }),
        },
      }),
    /** Tracked-file statuses (added/deleted/modified with diff counts). */
    status: (dir?: string) => client.get<FileStatusEntry[]>("/file/status", dirQuery(dir)),
  };
}

export type FileService = ReturnType<typeof createFileService>;
