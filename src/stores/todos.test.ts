// L1 tests for the todos store (TASK-M3-07): wholesale list replacement
// (initial fetch / list events), defensive single-todo upsert, server reset,
// and per-server/session isolation.

import { afterEach, describe, expect, it } from "vitest";
import { applyTodos, applyTodoUpdate, getServerTodos, resetServer, todos } from "./todos.js";
import type { Todo } from "../services/todo.js";

const SERVER = "srv-todos";

function todo(
  content: string,
  status: Todo["status"] = "pending",
  priority: Todo["priority"] = "medium",
): Todo {
  return { content, status, priority };
}

afterEach(() => {
  resetServer(SERVER);
});

describe("todos store", () => {
  it("applyTodos replaces a session's whole list", () => {
    const first = [todo("a", "in_progress", "high"), todo("b", "pending", "low")];
    applyTodos(SERVER, "ses_1", first);
    expect(todos[SERVER]["ses_1"]).toEqual(first);

    const second = [todo("a", "completed", "high")];
    applyTodos(SERVER, "ses_1", second);
    expect(todos[SERVER]["ses_1"]).toEqual(second);
    expect(getServerTodos(SERVER)["ses_1"]).toEqual(second);
  });

  it("ignores non-array applyTodos payloads", () => {
    applyTodos(SERVER, "ses_1", undefined as unknown as Todo[]);
    expect(todos[SERVER]).toBeUndefined();
  });

  it("applyTodoUpdate with an array replaces the whole list", () => {
    const list = [todo("a", "pending", "high"), todo("b", "pending", "low")];
    applyTodoUpdate(SERVER, "ses_1", list);
    expect(todos[SERVER]["ses_1"]).toEqual(list);
  });

  it("applyTodoUpdate with a single todo upserts on content", () => {
    applyTodos(SERVER, "ses_1", [todo("a", "pending", "high"), todo("b", "pending", "low")]);
    applyTodoUpdate(SERVER, "ses_1", todo("a", "completed", "high"));
    expect(todos[SERVER]["ses_1"]).toEqual([
      { content: "a", status: "completed", priority: "high" },
      todo("b", "pending", "low"),
    ]);
    applyTodoUpdate(SERVER, "ses_1", todo("c", "in_progress", "medium"));
    expect(todos[SERVER]["ses_1"]).toHaveLength(3);
  });

  it("ignores malformed single-todo updates", () => {
    applyTodos(SERVER, "ses_1", [todo("a")]);
    applyTodoUpdate(SERVER, "ses_1", null as unknown as Todo);
    expect(todos[SERVER]["ses_1"]).toEqual([todo("a")]);
  });

  it("keeps per-session and per-server lists isolated", () => {
    applyTodos(SERVER, "ses_1", [todo("a")]);
    applyTodos("srv-other", "ses_1", [todo("x")]);
    applyTodos(SERVER, "ses_2", [todo("b")]);
    expect(todos[SERVER]["ses_1"]).toEqual([todo("a")]);
    expect(todos[SERVER]["ses_2"]).toEqual([todo("b")]);
    expect(todos["srv-other"]["ses_1"]).toEqual([todo("x")]);
  });

  it("resetServer drops every session of the server", () => {
    applyTodos(SERVER, "ses_1", [todo("a")]);
    applyTodos(SERVER, "ses_2", [todo("b")]);
    resetServer(SERVER);
    expect(todos[SERVER]).toBeUndefined();
    expect(getServerTodos(SERVER)).toEqual({});
  });
});
