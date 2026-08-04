// Todo domain service (TASK-M3-07): typed wrapper around the session todo
// REST endpoint, factory form per architecture §4.4. Errors pass through as
// ApiError from the client (no catching here).

import type { components } from "./api/schema.js";
import { type ApiClient, type ApiPath } from "./client.js";

export type Todo = components["schemas"]["Todo"];

function todoPath(sessionID: string): ApiPath {
  return `/session/${sessionID}/todo` as ApiPath;
}

function dirQuery(dir?: string): { query: { directory: string } } | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

export function createTodoService(client: ApiClient) {
  return {
    /** List todos of a session (GET /session/{id}/todo). */
    list: (sessionID: string, dir?: string) =>
      client.get<Todo[]>(todoPath(sessionID), dirQuery(dir)),
  };
}

export type TodoService = ReturnType<typeof createTodoService>;
