// Session list (TASK-M2-04): the sidebar's lower section. Renders the
// server's sessions grouped by local time (Today / Yesterday / This Week /
// Earlier) with a status badge per session (busy spinner, idle dot, error
// red dot), a local search filter, the active-session highlight and a
// hover-actions stub (rename/delete are wired in M2-05). The store is
// SSE-driven, so grouping and badges update live without polling.
//
// Virtual scroll preparation: rows render plainly today; when session
// counts grow, swap the <For> bodies for a virtualized list (e.g.
// @tanstack/virtual) keeping the same group headers (M2-09).

import { createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import type { Session } from "../../services/session.js";
import {
  type SessionStatusEntry,
  getServerSessionState,
  setActiveSession,
} from "../../stores/session.js";
import { formatRelativeTime } from "../servers/relativeTime.js";
import { groupSessionsByTime, type SessionTimeGroup } from "./timeGroups.js";

export interface SessionListProps {
  /** The server whose sessions are shown. */
  serverId: string;
  /** Called when a session row is selected (chat view lands in M2-06/08). */
  onSelect: (sessionId: string) => void;
  /** Clock override for tests; defaults to the real wall clock. */
  nowMs?: number;
}

type StatusKind = "busy" | "idle" | "error" | "none";

/** Maps a status entry to a badge kind; retry counts as busy (still active). */
function statusKind(status: SessionStatusEntry | undefined): StatusKind {
  if (status === undefined) return "none";
  if (status.type === "busy" || status.type === "retry") return "busy";
  if (status.type === "idle") return "idle";
  return "error";
}

function badgeClass(kind: StatusKind): string {
  switch (kind) {
    case "busy":
      return "inline-block h-2.5 w-2.5 animate-spin rounded-full border border-accent border-t-transparent";
    case "idle":
      return "inline-block h-2 w-2 rounded-full bg-fg-faint";
    case "error":
      return "inline-block h-2 w-2 rounded-full bg-danger";
    default:
      return "";
  }
}

/** Row title: the server-provided title, falling back to the slug. */
function titleOf(session: Session): string {
  return session.title || session.slug;
}

function matchesQuery(session: Session, query: string): boolean {
  if (query === "") return true;
  return `${titleOf(session)} ${session.slug}`.toLowerCase().includes(query);
}

function StatusBadge(props: { status: SessionStatusEntry | undefined }) {
  const kind = () => statusKind(props.status);
  // Only retry/error entries carry a message (idle/busy do not).
  const message = () =>
    props.status !== undefined && "message" in props.status ? props.status.message : undefined;
  return (
    <Show when={kind() !== "none"}>
      <span
        data-testid="session-status"
        data-status={kind()}
        title={message()}
        class={badgeClass(kind())}
      />
    </Show>
  );
}

// Hover actions stub (TASK-M2-04): the "⋯" button establishes the pattern;
// M2-05 replaces it with a real rename/delete menu wired to the store.
function SessionRowMenu() {
  return (
    <button
      type="button"
      data-testid="session-row-menu"
      aria-label="Session actions"
      disabled
      class="invisible rounded-md px-1.5 text-sm leading-none text-fg-secondary opacity-0 transition-opacity group-hover:visible group-hover:opacity-100"
    >
      ⋯
    </button>
  );
}

function SessionRow(props: {
  session: Session;
  status: SessionStatusEntry | undefined;
  active: boolean;
  nowMs: number;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`session-item-${props.session.id}`}
      data-active={props.active ? "true" : "false"}
      aria-current={props.active ? "true" : undefined}
      class="group flex w-full cursor-pointer items-center gap-2 px-3 py-2 outline-none hover:bg-accent-soft focus:bg-accent-soft"
      onClick={() => props.onSelect(props.session.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect(props.session.id);
        }
      }}
    >
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm">{titleOf(props.session)}</span>
        <span class="block truncate font-code text-xs text-fg-secondary">
          {formatRelativeTime(props.session.time.updated, props.nowMs)}
        </span>
      </span>
      <StatusBadge status={props.status} />
      <SessionRowMenu />
    </div>
  );
}

const SessionList: Component<SessionListProps> = (props) => {
  const state = createMemo(() => getServerSessionState(props.serverId));
  const now = () => props.nowMs ?? Date.now();
  const [query, setQuery] = createSignal("");

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const st = state();
    const result: Session[] = [];
    for (const id of st.order) {
      const session = st.sessions[id];
      if (session !== undefined && matchesQuery(session, q)) result.push(session);
    }
    return result;
  });

  const groups = createMemo(() => groupSessionsByTime(filtered(), now()));

  function select(sessionId: string) {
    setActiveSession(props.serverId, sessionId);
    props.onSelect(sessionId);
  }

  return (
    <div data-testid="session-list" class="flex min-h-0 flex-1 flex-col">
      <div class="px-3 pb-2 pt-3">
        <input
          type="search"
          data-testid="session-search"
          aria-label="Search sessions"
          placeholder="Search sessions"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          class="w-full rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-sm outline-none placeholder:text-fg-faint focus:border-fg-faint"
        />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto pb-3">
        <Show
          when={groups().length > 0}
          fallback={
            <Show
              when={state().order.length === 0}
              fallback={
                <div data-testid="session-empty-filter" class="px-3 py-6 text-center">
                  <p class="text-sm text-fg-secondary">No matching sessions</p>
                </div>
              }
            >
              <div data-testid="session-empty" class="px-3 py-6 text-center">
                <p class="text-sm text-fg-secondary">No sessions yet</p>
                <p class="mt-1 text-xs text-fg-faint">New conversations appear here.</p>
              </div>
            </Show>
          }
        >
          <For each={groups()}>
            {(group: SessionTimeGroup) => (
              <section aria-label={group.label}>
                <div
                  data-testid={`session-group-${group.key}`}
                  class="sticky top-0 z-10 border-b border-bg-sunken bg-bg-elevated px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-fg-faint"
                >
                  {group.label}
                </div>
                <For each={group.sessions}>
                  {(session) => (
                    <SessionRow
                      session={session}
                      status={state().statuses[session.id]}
                      active={state().activeSessionId === session.id}
                      nowMs={now()}
                      onSelect={select}
                    />
                  )}
                </For>
              </section>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};

export default SessionList;
