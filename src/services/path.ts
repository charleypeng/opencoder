// Path domain service (TASK-UI-01 filepicker): typed wrapper around the
// instance path endpoint, factory form per architecture §4.4. The
// `directory` field is the server's workspace root — the filepicker uses
// it to tell whether a typed absolute path is listable at all (the real
// server rejects paths outside the workspace with a 500).

import type { components } from "./api/schema.js";
import type { ApiClient } from "./client.js";

export type PathInfo = components["schemas"]["Path"];

export function createPathService(client: ApiClient) {
  return {
    /** The instance's current paths (`directory` = workspace root). */
    get: () => client.get<PathInfo>("/path"),
  };
}

export type PathService = ReturnType<typeof createPathService>;
