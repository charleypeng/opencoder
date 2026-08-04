// Mobile sessions tab root (TASK-M7-03): a thin mobile session list over
// the SSE-fed session store. Rows push the Chat page onto the Sessions
// tab's stack (per-tab push navigation; Chat pops back). The desktop
// SessionList (tree, search, row actions) is sidebar-oriented; the mobile
// list grows its own UX in later M7 tasks (M7-06 gestures, M7-07
// transitions) — today it proves the list -> chat push flow. The header's
// back button exits the workspace to the servers home (the mobile
// equivalent of the desktop rail).

import { For, Show } from "solid-js";
import type { Component } from "solid-js";
import type { SessionStatusEntry } from "../../stores/session.js";
import { getServerSessionState, setActiveSession } from "../../stores/session.js";
import { push } from "./navigation.js";
import { PageHeader } from "./PageHeader.js";
import type { MobilePageProps } from "./pages.js";

/** Row status glyph: busy/retry spinner, error dot, or the idle dot. */
function statusDotClass(status: SessionStatusEntry | undefined): string {
  if (status?.type === "busy" || status?.type === "retry") {
    return "h-2.5 w-2.5 animate-spin rounded-full border border-accent border-t-transparent";
  }
  if (status?.type === "error") return "h-2 w-2 rounded-full bg-danger";
  return "h-2 w-2 rounded-full bg-fg-faint";
}

export const SessionsPage: Component<MobilePageProps> = (props) => {
  const state = () => getServerSessionState(props.serverId);
  return (
    <div class="flex h-full flex-col" data-testid="mobile-page-sessions-root">
      <PageHeader title="Sessions" onBack={props.onExit} backLabel="Servers" />
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={state().order.length > 0}
          fallback={
            <p data-testid="sessions-empty" class="p-4 text-sm text-fg-secondary">
              No sessions yet
            </p>
          }
        >
          <ul class="divide-y divide-bg-sunken">
            <For each={state().order}>
              {(id) => {
                const session = () => state().sessions[id];
                const status = () => state().statuses[id];
                return (
                  <li>
                    <button
                      type="button"
                      data-testid={`session-row-${id}`}
                      class="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-bg-sunken"
                      onClick={() => {
                        setActiveSession(props.serverId, id);
                        push({ page: "chat", params: { sessionId: id } });
                      }}
                    >
                      <span aria-hidden="true" class={statusDotClass(status())} />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium text-fg-primary">
                          {session()?.title || session()?.slug}
                        </span>
                        <span class="block truncate text-xs text-fg-secondary">
                          {session()?.slug}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
};
