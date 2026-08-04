// Command domain service (TASK-M5-03): typed wrappers around the slash
// command family — GET /command (the commands the server exposes, incl.
// custom server commands) and POST /session/{id}/command (run one in a
// session; the assistant message created by the server streams in via SSE
// like a prompt). Factory form per architecture §4.4. Errors pass through
// as ApiError from the client (no catching here).

import type { components, operations } from "./api/schema.js";
import { type ApiClient, type ApiPath, type RequestOptions } from "./client.js";

export type Command = components["schemas"]["Command"];
/** Request body of `POST /session/{id}/command` (name + free-form arguments). */
export type CommandRunInput = NonNullable<
  operations["session.command"]["requestBody"]
>["content"]["application/json"];
/** Response of `POST /session/{id}/command` (the created assistant message). */
export type CommandRunResult =
  operations["session.command"]["responses"]["200"]["content"]["application/json"];

// Explicit directory only when provided; the client's global directory
// injection handles the rest (TASK-M2-03 wires it up).
function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

function commandRunPath(sessionID: string): ApiPath {
  return `/session/${sessionID}/command` as ApiPath;
}

export function createCommandService(client: ApiClient) {
  return {
    /** List available slash commands (GET /command). */
    list: (dir?: string) => client.get<Command[]>("/command", dirQuery(dir)),
    /**
     * Run a command in a session (POST /session/{id}/command); the reply
     * streams in over SSE. `input.command` is the command name, `input.
     * arguments` the text after it (may be empty — the server then uses
     * the command's template).
     */
    run: (sessionID: string, input: CommandRunInput, dir?: string) =>
      client.post<CommandRunResult>(commandRunPath(sessionID), {
        body: input satisfies CommandRunInput,
        ...(dirQuery(dir) ?? {}),
      }),
  };
}

export type CommandService = ReturnType<typeof createCommandService>;
