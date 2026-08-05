// Log-forwarding domain service (TASK-M9-07): typed wrapper around the
// server-side log sink (POST /log), factory form per architecture §4.4.
// The diagnostics center forwards frontend error/warn entries here; the
// body is the contract's { service, level, message, extra? } object and
// the response is a plain boolean. Errors pass through as ApiError.

import type { operations } from "./api/schema.js";
import { type ApiClient, type RequestOptions } from "./client.js";

/** Request body of `POST /log` ({ service, level, message, extra? }). */
export type LogEntry = NonNullable<
  operations["app.log"]["requestBody"]
>["content"]["application/json"];

export type LogLevel = LogEntry["level"];

function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

export function createLogService(client: ApiClient) {
  return {
    /** Writes one log entry to the server logs (POST /log); resolves true. */
    write: (entry: LogEntry, dir?: string) =>
      client.post<boolean>("/log", { body: entry, ...(dirQuery(dir) ?? {}) }),
  };
}

export type LogService = ReturnType<typeof createLogService>;
