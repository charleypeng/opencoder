// Find domain service (TASK-M3-08 / TASK-M4-01): typed wrappers around the
// file, symbol and full-text search endpoints, factory form per architecture
// §4.4. Errors pass through as ApiError from the client (no catching here).

import type { components, operations } from "./api/schema.js";
import type { ApiClient } from "./client.js";

export type Symbol = components["schemas"]["Symbol"];
/** One `/find` text-search hit (path + line + submatch spans). */
export type FindMatch =
  operations["find.text"]["responses"]["200"]["content"]["application/json"][number];

export interface FindSearchOptions {
  dir?: string;
}

export function createFindService(client: ApiClient) {
  return {
    /** Fuzzy file search by name or path; resolves to matching paths. */
    files: (query: string, dir?: string) =>
      client.get<string[]>("/find/file", {
        query: dir === undefined ? { query } : { query, directory: dir },
      }),
    /** Workspace symbol search (functions/classes/variables by name). */
    symbols: (query: string, dir?: string) =>
      client.get<Symbol[]>("/find/symbol", {
        query: dir === undefined ? { query } : { query, directory: dir },
      }),
    /**
     * Full-text search. The 1.18.11 contract exposes only `pattern` (no
     * regex flag), so the M4-05 regex toggle compiles patterns client-side
     * or follows a contract bump.
     */
    search: (pattern: string, options: FindSearchOptions = {}) =>
      client.get<FindMatch[]>("/find", {
        query: options.dir === undefined ? { pattern } : { pattern, directory: options.dir },
      }),
  };
}

export type FindService = ReturnType<typeof createFindService>;
