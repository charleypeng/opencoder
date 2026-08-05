// Live todo panel (TASK-M3-07): the task list for one session. On mount /
// session change the initial list is fetched from GET /session/{id}/todo
// and applied to the todos store; `todo.updated` SSE events (routed in
// stores/events.ts) replace the store list, so rendering is purely
// store-driven and updates arrive live with no extra requests.
//
// Each row renders a status icon (pending hollow circle / in_progress
// spinner / completed check / cancelled cross), the content text
// (strikethrough + muted when completed) and a priority color dot
// (high red / medium amber / low gray; dots are skipped when a todo lacks
// a priority). `variant` reserves the mobile bottom-sheet container for M7;
// the desktop drawer and the future sheet share this component.

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { getApiClient } from "../../services/client.js";
import { createTodoService, type Todo } from "../../services/todo.js";
import { applyTodos, todos } from "../../stores/todos.js";
import { getActiveDirectory } from "../../stores/project.js";
import { useT } from "../../i18n/index.js";

export interface TodoPanelProps {
  /** The server whose session todos are shown. */
  serverId: string;
  /** The session to render todos for. */
  sessionId: string;
  /** Container variant: desktop right panel or (M7) mobile bottom sheet. */
  variant?: "panel" | "sheet";
}

/** Priority color dot: high red, medium amber, low gray. */
const priorityDot: Record<string, string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-fg-faint",
};

function iconClass(status: Todo["status"]): string {
  switch (status) {
    case "completed":
      return "h-4 w-4 shrink-0 text-success";
    case "in_progress":
      return "h-4 w-4 shrink-0 animate-spin text-fg-secondary";
    default:
      return "h-4 w-4 shrink-0 text-fg-faint";
  }
}

function StatusIcon(props: { status: Todo["status"] }) {
  return (
    <svg
      aria-hidden
      data-testid="todo-status-icon"
      class={iconClass(props.status)}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <Show when={props.status === "pending"}>
        <circle cx="8" cy="8" r="5.5" />
      </Show>
      <Show when={props.status === "in_progress"}>
        <path d="M14 8a6 6 0 1 1-1.76-4.24" />
      </Show>
      <Show when={props.status === "completed"}>
        <path d="M3 8.5 6.5 12 13 4.5" />
      </Show>
      <Show when={props.status === "cancelled"}>
        <path d="M5 5l6 6M11 5l-6 6" />
      </Show>
    </svg>
  );
}

function TodoRow(props: { todo: Todo }) {
  const completed = () => props.todo.status === "completed";
  return (
    <li
      data-testid="todo-item"
      data-status={props.todo.status}
      class="flex items-center gap-2.5 py-1.5"
    >
      <StatusIcon status={props.todo.status} />
      <span
        data-testid="todo-content"
        class={`min-w-0 flex-1 break-words text-sm ${
          completed() ? "text-fg-faint line-through" : "text-fg-primary"
        }`}
      >
        {props.todo.content}
      </span>
      <Show when={priorityDot[props.todo.priority ?? ""] !== undefined}>
        <span
          data-testid="todo-priority"
          data-priority={props.todo.priority}
          title={props.todo.priority}
          class={`h-2 w-2 shrink-0 rounded-full ${priorityDot[props.todo.priority ?? ""]}`}
        />
      </Show>
    </li>
  );
}

const TodoPanel: Component<TodoPanelProps> = (props) => {
  const t = useT();
  const [error, setError] = createSignal<unknown>(null);
  const [loadKey, setLoadKey] = createSignal(0);

  // Initial fetch: re-runs on session/server change and on retry. Failures
  // surface as an inline error + retry; the store keeps the last known list
  // until the next todo.updated event heals it.
  createEffect(() => {
    // Reactive keys: the reads re-run this effect on session/server change.
    void props.serverId;
    void props.sessionId;
    loadKey(); // tracked so retry re-runs the fetch
    setError(null);
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void (async () => {
      try {
        const list = await createTodoService(getApiClient()).list(
          props.sessionId,
          getActiveDirectory(),
        );
        if (cancelled) return;
        applyTodos(props.serverId, props.sessionId, list);
      } catch (err) {
        if (cancelled) return;
        setError(err);
      }
    })();
  });

  const list = () => todos[props.serverId]?.[props.sessionId] ?? [];

  return (
    <section
      data-testid="todo-panel"
      data-variant={props.variant ?? "panel"}
      class="flex h-full min-h-0 flex-col"
    >
      <Show
        when={error()}
        fallback={
          <ul class="min-h-0 flex-1 overflow-y-auto px-4 py-2">
            <For each={list()}>{(todo) => <TodoRow todo={todo} />}</For>
          </ul>
        }
      >
        <div class="flex flex-col gap-2 px-4 py-3">
          <p data-testid="todo-error" class="text-xs text-danger">
            {t("sessions:todosLoadFailed")}
          </p>
          <button
            type="button"
            data-testid="todo-retry"
            class="self-start rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary hover:text-fg-primary"
            onClick={() => setLoadKey((key) => key + 1)}
          >
            {t("common:retry")}
          </button>
        </div>
      </Show>
      <Show when={!error() && list().length === 0}>
        <p data-testid="todo-empty" class="px-4 py-6 text-center text-sm text-fg-secondary">
          {t("sessions:noTodos")}
        </p>
      </Show>
    </section>
  );
};

export default TodoPanel;
