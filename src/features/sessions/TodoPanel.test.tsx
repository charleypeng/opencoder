// L2 tests for the live todo panel (TASK-M3-07): the initial list is
// fetched on mount and applied to the todos store, rows render status
// icons + priority color dots + completed strikethrough, the empty state
// shows without todos, a store mutation (live todo.updated event path)
// re-renders immediately, and fetch failures surface an inline error with
// a working retry.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import TodoPanel from "./TodoPanel";
import type { Todo } from "../../services/todo";
import { applyTodos, getServerTodos, resetServer as resetTodos } from "../../stores/todos";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-todo";
const SESSION = "ses_1";

function todo(content: string, status: Todo["status"], priority: Todo["priority"]): Todo {
  return { content, status, priority };
}

function mockClient() {
  const client = {
    get: vi.fn(async (): Promise<unknown> => []),
    post: vi.fn(async (): Promise<unknown> => undefined),
    patch: vi.fn(async (): Promise<unknown> => undefined),
    put: vi.fn(async (): Promise<unknown> => undefined),
    delete: vi.fn(async (): Promise<unknown> => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

beforeEach(() => {
  mockClient();
});

afterEach(() => {
  resetTodos(SERVER);
  vi.clearAllMocks();
});

describe("TodoPanel", () => {
  it("renders todos from the store with status icons, priority dots and strikethrough", async () => {
    // The mount fetch resolves undefined so it cannot clobber the seeded list.
    mockClient().get.mockResolvedValue(undefined);
    applyTodos(SERVER, SESSION, [
      todo("Fix the login flow", "pending", "high"),
      todo("Write the tests", "in_progress", "medium"),
      todo("Ship the release", "completed", "low"),
    ]);
    render(() => <TodoPanel serverId={SERVER} sessionId={SESSION} />);

    await waitFor(() => expect(screen.getAllByTestId("todo-item")).toHaveLength(3));

    const items = screen.getAllByTestId("todo-item");
    expect(items[0]).toHaveAttribute("data-status", "pending");
    expect(items[1]).toHaveAttribute("data-status", "in_progress");
    expect(items[2]).toHaveAttribute("data-status", "completed");

    expect(screen.getByText("Fix the login flow")).toBeInTheDocument();
    expect(screen.getByText("Write the tests")).toBeInTheDocument();

    // Completed content is struck through and muted.
    const done = screen.getByText("Ship the release");
    expect(done).toHaveClass("line-through");
    expect(done).toHaveClass("text-fg-faint");

    // Priority dots: high red / medium amber / low gray.
    const dots = screen.getAllByTestId("todo-priority");
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveAttribute("data-priority", "high");
    expect(dots[1]).toHaveAttribute("data-priority", "medium");
    expect(dots[2]).toHaveAttribute("data-priority", "low");

    // Status icons render per item.
    expect(screen.getAllByTestId("todo-status-icon")).toHaveLength(3);
  });

  it("shows the empty state when the store has no todos", async () => {
    render(() => <TodoPanel serverId={SERVER} sessionId={SESSION} />);
    expect(await screen.findByTestId("todo-empty")).toBeInTheDocument();
    expect(screen.getByText("No todos yet")).toBeInTheDocument();
  });

  it("fetches the initial list on mount and applies it to the store", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([todo("Fetch me", "pending", "high")]);
    render(() => <TodoPanel serverId={SERVER} sessionId={SESSION} />);

    await waitFor(() =>
      expect(screen.getByTestId("todo-item")).toHaveAttribute("data-status", "pending"),
    );
    expect(client.get).toHaveBeenCalledWith("/session/ses_1/todo", undefined);
    expect(getServerTodos(SERVER)[SESSION]).toEqual([todo("Fetch me", "pending", "high")]);
    expect(screen.getByText("Fetch me")).toBeInTheDocument();
  });

  it("updates live when the store changes (todo.updated event path)", async () => {
    mockClient().get.mockResolvedValue(undefined);
    applyTodos(SERVER, SESSION, [todo("Explore", "in_progress", "high")]);
    render(() => <TodoPanel serverId={SERVER} sessionId={SESSION} />);
    await waitFor(() => expect(screen.getByTestId("todo-item")).toBeInTheDocument());
    expect(screen.getByText("Explore")).not.toHaveClass("line-through");

    // A todo.updated event replaces the whole list in the store.
    applyTodos(SERVER, SESSION, [todo("Explore", "completed", "high")]);
    await waitFor(() =>
      expect(screen.getByTestId("todo-item")).toHaveAttribute("data-status", "completed"),
    );
    expect(screen.getByText("Explore")).toHaveClass("line-through");

    // And a fresh list (new item) re-renders without remount.
    applyTodos(SERVER, SESSION, [
      todo("Explore", "completed", "high"),
      todo("Ship", "pending", "medium"),
    ]);
    await waitFor(() => expect(screen.getAllByTestId("todo-item")).toHaveLength(2));
    expect(screen.getByText("Ship")).toBeInTheDocument();
  });

  it("keeps the previous list visible while a retry is pending after a fetch failure", async () => {
    const client = mockClient();
    client.get.mockRejectedValue(new Error("boom"));
    render(() => <TodoPanel serverId={SERVER} sessionId={SESSION} />);

    expect(await screen.findByTestId("todo-error")).toBeInTheDocument();
    expect(screen.getByText("Failed to load todos.")).toBeInTheDocument();

    // Retry succeeds and fills the panel.
    client.get.mockResolvedValue([todo("Recovered", "pending", "low")]);
    fireEvent.click(screen.getByTestId("todo-retry"));
    await waitFor(() => expect(screen.getByText("Recovered")).toBeInTheDocument());
    expect(screen.queryByTestId("todo-error")).not.toBeInTheDocument();
  });
});
