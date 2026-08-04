// Skill domain service (TASK-M5-08): typed wrapper around GET /skill (the
// skills the server exposes for `@name` references — name/description/
// location/content). The 1.18.11 contract carries no hidden flag: skills
// marked hidden in their SKILL.md frontmatter are filtered server-side and
// never appear in this list. Factory form per architecture §4.4. Errors
// pass through as ApiError from the client (no catching here).

import type { operations } from "./api/schema.js";
import { type ApiClient, type RequestOptions } from "./client.js";

/** A server-side skill (GET /skill item, verified against 1.18.11). */
export type Skill =
  operations["app.skills"]["responses"]["200"]["content"]["application/json"][number];

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

export function createSkillService(client: ApiClient) {
  return {
    /** List the skills the server exposes for `@name` references (GET /skill). */
    list: (dir?: string) => client.get<Skill[]>("/skill", dirQuery(dir)),
  };
}

export type SkillService = ReturnType<typeof createSkillService>;
