// Subtask panel (sidebar nav redesign): the per-session task surface that
// lives next to the chat — the Todo list (reusing TodoPanel) plus the
// session's sub-agent CHILD sessions (GET /session/{id}/children + SSE
// session.updated). Child sessions never render in the sidebar workspace
// tree; this panel is their home. Clicking a child switches to it.

import { createEffect, createMemo, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { getApiClient } from "../../services/client.js";
import { createSessionService, type Session } from "../../services/session.js";
import { getServerSessionState, upsertSession } from "../../stores/session.js";
import { formatRelativeTime } from "../servers/relativeTime.js";
import { useT } from "../../i18n/index.js";
import TodoPanel from "./TodoPanel.js";

export interface SubtaskPanelProps {
  /** The server whose session subtasks are shown. */
  serverId: string;
  /** The session whose todos + children are rendered. */
  sessionId: string;
  /** Called when a child session row is selected (switch to it). */
  onSelectSession: (sessionId: string) => void;
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

const SubtaskPanel: Component<SubtaskPanelProps> = (props) => {
  const t = useT();

  // Fetch the children once per (server, session): merge them into the
  // global session store (upsert) so SSE session.updated events keep the
  // list fresh afterwards — the same pattern the workspace tree uses for
  // the active directory. Failures are silent: the store keeps the last
  // known set until the next successful fetch or SSE event.
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

  const state = createMemo(() => getServerSessionState(props.serverId));

  return (
    <div data-testid="subtask-panel" class="flex h-full min-h-0 flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto">
        <TodoPanel serverId={props.serverId} sessionId={props.sessionId} variant="panel" />
      </div>
      <div data-testid="subtask-children" class="shrink-0 border-t border-bg-sunken px-4 py-2">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-medium text-fg-secondary">{t("sessions:subtasks")}</h3>
          <Show when={children().length > 0}>
            <span data-testid="subtask-count" class="text-[10px] text-fg-faint">
              {children().length}
            </span>
          </Show>
        </div>
        <Show
          when={children().length > 0}
          fallback={
            <p data-testid="subtask-empty" class="mt-1 text-xs text-fg-faint">
              {t("sessions:noSubtasks")}
            </p>
          }
        >
          <ul class="mt-1 max-h-40 overflow-y-auto">
            <For each={children()}>
              {(child) => (
                <li>
                  <button
                    type="button"
                    data-testid={`subtask-child-${child.id}`}
                    onClick={() => props.onSelectSession(child.id)}
                    class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-fg-secondary outline-none hover:bg-accent-soft hover:text-fg-primary focus:bg-accent-soft focus:text-fg-primary"
                  >
                    <span
                      data-testid="subtask-child-status"
                      class={`shrink-0 ${childStatusDot(state().statuses[child.id])}`}
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
    </div>
  );
};

export default SubtaskPanel;
