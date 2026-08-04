// Message domain service (TASK-M2-01): typed wrappers around the session
// message REST endpoints, factory form per architecture §4.4. Errors pass
// through as ApiError from the client (no catching here).

import type { components } from "./api/schema.js";
import { type ApiClient, type ApiPath } from "./client.js";

export interface SessionMessage {
  info: components["schemas"]["Message"];
  parts: components["schemas"]["Part"][];
}

export interface MessageListOptions {
  /** Maximum number of messages to return. */
  limit?: number;
  /** Cursor: only return messages older than this message id. */
  before?: string;
  /** Explicit directory override; defaults to the client's global directory. */
  dir?: string;
}

function messagePath(sessionID: string, messageID?: string): ApiPath {
  return `/session/${sessionID}/message${messageID ? `/${messageID}` : ""}` as ApiPath;
}

export function createMessageService(client: ApiClient) {
  return {
    /** List messages of a session with optional pagination. */
    list: (sessionID: string, options: MessageListOptions = {}) => {
      const query: Record<string, string | number> = {};
      if (options.limit !== undefined) query.limit = options.limit;
      if (options.before !== undefined) query.before = options.before;
      if (options.dir !== undefined) query.directory = options.dir;
      return client.get<SessionMessage[]>(messagePath(sessionID), { query });
    },
    /** Retrieve a specific message by id. */
    get: (sessionID: string, messageID: string, dir?: string) =>
      client.get<SessionMessage>(
        messagePath(sessionID, messageID),
        dir === undefined ? undefined : { query: { directory: dir } },
      ),
  };
}

export type MessageService = ReturnType<typeof createMessageService>;
