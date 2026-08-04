// Find domain service (TASK-M3-08): typed wrappers around the file/symbol
// search endpoints, factory form per architecture §4.4. Errors pass through
// as ApiError from the client (no catching here).

import type { ApiClient } from "./client.js";

export function createFindService(client: ApiClient) {
  return {
    /** Fuzzy file search by name or path; resolves to matching paths. */
    files: (query: string, dir?: string) =>
      client.get<string[]>("/find/file", {
        query: dir === undefined ? { query } : { query, directory: dir },
      }),
  };
}

export type FindService = ReturnType<typeof createFindService>;
