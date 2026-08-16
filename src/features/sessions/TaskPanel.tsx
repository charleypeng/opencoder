// Task panel (composer dock): the collapsible surface above the chat
// composer holding the active session's todo list AND its sub-agent child
// sessions (absorbed from SubtaskPanel). Behaviour follows the design
// reference: the panel auto-expands when todos/subtasks appear, auto-
// collapses when everything completes, and the user can collapse/expand
// it manually (the header chevron, or a fresh task auto-reopens it).
// Child rows switch to the child session; while the active session is
// itself a child, a back affordance returns to the parent session.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { getApiClient } from "../../services/client.js";
import { createSessionService, type Session } from "../../services/session.js";
import { getServerSessionState, upsertSession } from "../../stores/session.js";
import { todos } from "../../stores/todos.js";
import { formatRelativeTime } from "../servers/relativeTime.js";
import { useT } from "../../i18n/index.js";
import TodoPanel from "./TodoPanel.js";

export interface TaskPanelProps {
  /** The server whose session tasks are shown. */
  serverId: string;
  /** The session whose todos + children are rendered. */
  sessionId: string;
  /** Called when a child session row is selected (switch to it). */
  onSelectSession: (sessionId: string) => void;
  /** Called by the back affordance when the active session is a child
   *  (returns to its parent session). */
  onBackToParent: () => void;
  /** Incrementing token: each change force-expands the panel (the
   *  "Tasks" header button in the chat header reuses this). */
  expandToken?: number;
}

/** Child rows reuse the workspace-tree status-dot styling. */
function childStatusDot(status: { type: string } | undefined): string {
  if (status === undefined) return "";
  if (status.type === "busy" || status.type === "retry") {
    return "h-2.5 w-2.5 animate-spin rounded-full border border-accent border-t-transparent";
  }
  if (status.type === "error") return "h-2 w-2 rounded-full bg-danger";
  return "h-2 w-2 rounded-full bg-fg-faint";
}

function childTitle(session: Session): string {
  return session.title || session.slug;
}

const TaskPanel: Component<TaskPanelProps> = (props) => {
  const t = useT();

  // Fetch the children once per (server, session): merge them into the
  // global session store (upsert) so SSE session.updated events keep the
  // list fresh afterwards — the same pattern SubtaskPanel used.
  createEffect(() => {
    const serverId = props.serverId;
    const sessionId = props.sessionId;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void createSessionService(getApiClient())
      .children(sessionId)
      .then((children) => {
        if (cancelled) return;
        for (const child of children ?? []) upsertSession(serverId, child);
      })
      .catch(() => undefined);
  });

  // Children are the store's sessions whose parentID points at this one.
  const children = createMemo(() => {
    const state = getServerSessionState(props.serverId);
    return state.order
      .map((id) => state.sessions[id])
      .filter((s): s is Session => s !== undefined && s.parentID === props.sessionId);
  });

  // Whether the ACTIVE session is itself a child session (back affordance).
  const isChildSession = createMemo(() => {
    const state = getServerSessionState(props.serverId);
    return state.sessions[props.sessionId]?.parentID !== undefined;
  });

  const list = () => todos[props.serverId]?.[props.sessionId] ?? [];
  const totalCount = () => list().length;
  const completedCount = () => list().filter((todo) => todo.status === "completed").length;
  const hasPending = () =>
    list().some((todo) => todo.status !== "completed" && todo.status !== "cancelled");
  const activeChildren = createMemo(() =>
    children().filter((child) => {
      const status = getServerSessionState(props.serverId).statuses[child.id]?.type;
      return status === "busy" || status === "retry";
    }),
  );

  // Panel visibility: nothing to show → render nothing at all. A child
  // session always shows the panel (its back affordance is the only way
  // to return to the parent once inside a sub-agent session).
  const hasContent = () => totalCount() > 0 || children().length > 0 || isChildSession();
  // Activity = pending todos or child sessions that are still busy.
  const hasActivity = () => hasPending() || activeChildren().length > 0;
  // Everything done: completed todos and no child session is still active.
  const allDone = () => totalCount() > 0 && !hasPending() && activeChildren().length === 0;

  // Collapse state: null = automatic (follow activity), true/false = the
  // user's manual choice. A fresh task resets the manual override so the
  // panel re-opens; everything completing collapses it automatically.
  const [manualCollapsed, setManualCollapsed] = createSignal<boolean | null>(null);
  const [agentOpen, setAgentOpen] = createSignal(false);

  // Auto-expand when activity appears (or an external expand request
  // arrives via expandToken).
  createEffect(() => {
    if (hasActivity() || (props.expandToken ?? 0) > 0) setManualCollapsed(null);
    void props.expandToken;
    void hasActivity();
  });

  const collapsed = createMemo(() => {
    if (allDone()) return true;
    const manual = manualCollapsed();
    if (manual !== null) return manual;
    return !hasActivity();
  });

  return (
    <Show when={hasContent()}>
      <div
        data-testid="task-panel"
        data-collapsed={collapsed() ? "true" : "false"}
        class="mx-3 mb-1 overflow-hidden rounded-lg border border-bg-sunken bg-bg-elevated/70 shadow-sm"
      >
        {/* Header: back (child sessions) + collapse chevron + task title
            with the n/m progress, mirroring the reference design. */}
        <div class="flex items-center gap-1.5 px-2.5 py-1.5">
          <Show when={isChildSession()}>
            <button
              type="button"
              data-testid="task-panel-back"
              aria-label={t("sessions:backToParent")}
              title={t("sessions:backToParent")}
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-secondary outline-none hover:bg-bg-sunken hover:text-fg-primary"
              onClick={() => props.onBackToParent()}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </Show>
          <button
            type="button"
            data-testid="task-panel-toggle"
            aria-expanded={!collapsed() ? "true" : "false"}
            aria-label={t(collapsed() ? "sessions:expand" : "sessions:collapse")}
            class="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left outline-none hover:bg-bg-sunken"
            onClick={() => setManualCollapsed(collapsed() ? false : true)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class={`h-3 w-3 shrink-0 text-fg-secondary transition-transform ${
                collapsed() ? "" : "rotate-180"
              }`}
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-3.5 w-3.5 shrink-0 text-fg-secondary"
              aria-hidden="true"
            >
              <path d="M9 6h11M9 12h11M9 18h11" />
              <circle cx="4.5" cy="6" r="1" />
              <circle cx="4.5" cy="12" r="1" />
              <circle cx="4.5" cy="18" r="1" />
            </svg>
            <span class="min-w-0 truncate text-xs font-medium text-fg-primary">
              {t("sessions:taskPanelTitle")}
            </span>
            <span data-testid="task-panel-progress" class="shrink-0 text-[10px] text-fg-faint">
              {completedCount()}/{totalCount()}
            </span>
          </button>
        </div>

        <Show when={!collapsed()}>
          <div class="max-h-56 min-h-0 overflow-y-auto border-t border-bg-sunken px-3 py-1">
            <TodoPanel serverId={props.serverId} sessionId={props.sessionId} variant="compact" />
          </div>

          {/* Children group: collapsible, like the reference design's
              "N agents" section. */}
          <Show when={children().length > 0}>
            <div data-testid="task-panel-children" class="border-t border-bg-sunken px-2 py-1">
              <button
                type="button"
                data-testid="task-panel-children-toggle"
                aria-expanded={agentOpen() ? "true" : "false"}
                class="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[11px] text-fg-secondary outline-none hover:bg-bg-sunken hover:text-fg-primary"
                onClick={() => setAgentOpen((open) => !open)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class={`h-2.5 w-2.5 transition-transform ${agentOpen() ? "rotate-90" : ""}`}
                  aria-hidden="true"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="h-3 w-3"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="7" r="3" />
                  <path d="M5 20a7 7 0 0 1 14 0" />
                </svg>
                <span data-testid="task-panel-children-count">
                  {t("sessions:subtaskGroup", { count: children().length })}
                </span>
              </button>
              <Show when={agentOpen()}>
                <ul class="mt-0.5 max-h-40 overflow-y-auto">
                  <For each={children()}>
                    {(child) => (
                      <li>
                        <button
                          type="button"
                          data-testid={`task-panel-child-${child.id}`}
                          onClick={() => props.onSelectSession(child.id)}
                          class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-fg-secondary outline-none hover:bg-accent-soft hover:text-fg-primary focus:bg-accent-soft focus:text-fg-primary"
                        >
                          <span
                            data-testid="task-panel-child-status"
                            class={`shrink-0 ${childStatusDot(
                              getServerSessionState(props.serverId).statuses[child.id],
                            )}`}
                          />
                          <span class="min-w-0 flex-1 truncate">{childTitle(child)}</span>
                          <span class="shrink-0 font-code text-[10px] text-fg-faint">
                            {formatRelativeTime(child.time.updated)}
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  );
};

export default TaskPanel;
