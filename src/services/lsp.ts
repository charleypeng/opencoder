// LSP + formatter domain service (TASK-M9-07): typed wrappers around the
// LSP server status (GET /lsp -> LSPStatus[]) and the formatter status
// (GET /formatter -> FormatterStatus[]) endpoints, factory form per
// architecture §4.4. Errors pass through as ApiError from the client.
// The `lsp.updated` SSE event carries an empty properties object (verified
// against the 1.18.11 EventLspUpdated schema), so the status bar refetches
// this endpoint on every event instead of reading the payload.

import type { components } from "./api/schema.js";
import { type ApiClient, type RequestOptions } from "./client.js";

export type LSPStatus = components["schemas"]["LSPStatus"];
export type FormatterStatus = components["schemas"]["FormatterStatus"];

function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

export function createLspService(client: ApiClient) {
  return {
    /** List LSP servers and their connection state (GET /lsp). */
    status: (dir?: string) => client.get<LSPStatus[]>("/lsp", dirQuery(dir)),
    /** List formatters and whether they are enabled (GET /formatter). */
    formatters: (dir?: string) => client.get<FormatterStatus[]>("/formatter", dirQuery(dir)),
  };
}

export type LspService = ReturnType<typeof createLspService>;
