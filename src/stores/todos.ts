// Todos store (TASK-M3-07): per-server per-session todo lists fed by the
// initial GET /session/{id}/todo fetch and `todo.updated` SSE events. The
// event payload is a full-list envelope (schema properties: sessionID +
// todos[]), so applyTodoUpdate replaces the session's list wholesale; a
// single-todo envelope is handled defensively by upserting on content (the
// 1.18.11 Todo schema carries no id field).

import { createStore, produce } from "solid-js/store";
import type { Todo } from "../services/todo.js";

export type TodosMap = Record<string, Record<string, Todo[]>>;

const [todos, setTodos] = createStore<TodosMap>({});

/** Reactive per-server todo lists (server -> session -> todos). */
export { todos };

/** Non-reactive read of one server's session todo lists. */
export function getServerTodos(serverId: string): Record<string, Todo[]> {
  return todos[serverId] ?? {};
}

/** Replaces a session's whole todo list (initial fetch / list events). */
export function applyTodos(serverId: string, sessionId: string, list: Todo[]): void {
  if (!Array.isArray(list)) return;
  setTodos(
    produce((draft) => {
      const server = draft[serverId] ?? {};
      server[sessionId] = [...list];
      draft[serverId] = server;
    }),
  );
}

/**
 * Applies a `todo.updated` payload. The schema carries a full `todos`
 * array (wholesale replacement); a single-todo envelope is handled
 * defensively by upserting on content (no id in the 1.18.11 Todo schema).
 */
export function applyTodoUpdate(serverId: string, sessionId: string, update: Todo | Todo[]): void {
  if (Array.isArray(update)) {
    applyTodos(serverId, sessionId, update);
    return;
  }
  if (update === null || typeof update !== "object") return;
  setTodos(
    produce((draft) => {
      const server = draft[serverId] ?? {};
      const list = server[sessionId] ?? [];
      const next = [...list];
      const index = next.findIndex((todo) => todo.content === update.content);
      if (index === -1) next.push(update);
      else next[index] = update;
      server[sessionId] = next;
      draft[serverId] = server;
    }),
  );
}

/** Clears all todos for a server (drop before full re-sync). */
export function resetServer(serverId: string): void {
  setTodos(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
