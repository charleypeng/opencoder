// Project domain service (TASK-M2-01): typed wrappers around the project
// REST endpoints, factory form per architecture §4.4. Errors pass through
// as ApiError from the client (no catching here).

import type { components } from "./api/schema.js";
import { type ApiClient, type RequestOptions } from "./client.js";

export type Project = components["schemas"]["Project"];
/** Path info of the current OpenCode instance (`GET /path`). */
export type ProjectPath = components["schemas"]["Path"];

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

export function createProjectService(client: ApiClient) {
  return {
    /** List all projects that have been opened with OpenCode. */
    list: (dir?: string) => client.get<Project[]>("/project", dirQuery(dir)),
    /** Retrieve the currently active project. */
    current: (dir?: string) => client.get<Project>("/project/current", dirQuery(dir)),
    /** Retrieve the current working directory and related path information. */
    path: (dir?: string) => client.get<ProjectPath>("/path", dirQuery(dir)),
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
