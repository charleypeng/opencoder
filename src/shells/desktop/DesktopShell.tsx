// Desktop workspace shell (TASK-M1-08): the three-column skeleton (Rail |
// Sidebar | Main) mounted when a server is opened from ServerHome. Mounting
// sets the active server context (registry store); unmounting clears it and
// tears down that server's SSE stream. The rail mirrors the server list
// (listServers + servers-changed) with a health dot per server and offers
// ⌘/Ctrl+1..9 switching in list order. The sidebar holds the project/folder
// switcher (TASK-M2-03) on top and the session list (TASK-M2-04) below; the
// main pane shows the chat transcript (TASK-M2-06) for the store's active
// session id (set by row selection and by the "New session" flow,
// TASK-M2-05), keeping a placeholder only while no session is open. This
// shell owns the per-directory SSE subscription and rebuilds it whenever the
// active server or the active directory changes, re-syncing the stores so
// sessions and messages never mix across contexts.

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { subscribeToServersChanged } from "../../services/events";
import { listServers } from "../../services/servers";
import type { ServerEntry } from "../../services/servers";
import { getApiClient } from "../../services/client";
import { createProjectService } from "../../services/project";
import { connections, subscribeToServerHealth } from "../../stores/connection";
import { registry, setActiveServer } from "../../stores/registry";
import { getServerProjectState } from "../../stores/project";
import { getServerSessionState, resetServer as resetSessions } from "../../stores/session";
import { resetServer as resetMessages } from "../../stores/messages";
import { resetServer as resetTodos } from "../../stores/todos";
import { subscribeToServerEvents, type SubscribeToServerEventsResult } from "../../stores/events";
import ProjectSwitcher from "../../features/sessions/ProjectSwitcher";
import PromptBox from "../../features/sessions/PromptBox";
import SessionErrorBanner from "../../features/sessions/SessionErrorBanner";
import SessionList from "../../features/sessions/SessionList";
import TodoPanel from "../../features/sessions/TodoPanel";
import MessageList from "../../features/messages/MessageList";

export interface DesktopShellProps {
  /** The server opened from the home screen (initially active). */
  server: ServerEntry;
  /** Called to leave the workspace and return to the servers home. */
  onExit: () => void;
}

type HealthKind = "ok" | "slow" | "down" | "unknown";

const dotClass: Record<HealthKind, string> = {
  ok: "bg-success",
  slow: "bg-warning",
  down: "bg-danger",
  unknown: "bg-fg-faint",
};

function healthKind(server: ServerEntry): HealthKind {
  return connections[server.id]?.status ?? "unknown";
}

/** Chat header title: the server-provided title, falling back to the slug
 * and finally the raw session id. Reads the reactive store directly. */
function titleOf(serverId: string, sessionId: string): string {
  const session = getServerSessionState(serverId).sessions[sessionId];
  return session ? session.title || session.slug || sessionId : sessionId;
}

const DesktopShell: Component<DesktopShellProps> = (props) => {
  const [servers, setServers] = createSignal<ServerEntry[]>([]);
  // Main-pane placeholder target: the store's active session id, so both
  // row selection and the "New session" flow update it. The per-server
  // bucket is wiped on every context rebuild, so the placeholder can never
  // show a session from another server's context.
  const activeServerId = () => registry.activeServerId ?? props.server.id;
  const activeSessionId = createMemo(() => getServerSessionState(activeServerId()).activeSessionId);
  // Todo drawer (TASK-M3-07): local open state; closes on Esc or backdrop.
  const [todosOpen, setTodosOpen] = createSignal(false);
  const closeTodos = () => setTodosOpen(false);

  createEffect(() => {
    if (!todosOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTodos();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  async function refresh() {
    try {
      setServers(await listServers());
    } catch {
      // The servers-changed event delivers the list on the next change.
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (!/^[1-9]$/.test(event.key)) return;
    const target = servers()[Number(event.key) - 1];
    if (!target) return;
    event.preventDefault();
    setActiveServer(target.id);
  }

  // SSE wiring (TASK-M2-03): one subscription per (server, directory)
  // context. The effect re-runs when the active server or its active
  // directory changes, tearing down the old stream and opening a new one
  // for the new context before re-syncing. A version counter rejects
  // stale async rebuilds so rapid switches never leak subscriptions.
  let sse: SubscribeToServerEventsResult | undefined;
  let rebuildVersion = 0;

  async function rebuild(
    serverId: string | null,
    directory: string | undefined,
    version: number,
  ): Promise<void> {
    const previous = sse;
    sse = undefined;
    if (previous) await previous.unsubscribe();
    if (serverId === null || version !== rebuildVersion) return;
    // Drop the previous context's sessions, messages and todos so the new
    // directory's data can never mix with the old one; the re-sync
    // re-applies fresh snapshots right after the stream is up.
    resetSessions(serverId);
    resetMessages(serverId);
    resetTodos(serverId);
    let dir = directory;
    if (dir === undefined) {
      // Context not seeded yet (mount / server switch): resolve the current
      // project so the per-directory stream is opened instead of the global
      // one; the re-sync fills the store from the same lookup.
      try {
        const currentProject = await createProjectService(getApiClient()).current();
        if (version !== rebuildVersion) return;
        dir = currentProject?.worktree;
      } catch {
        // Unreachable server: stay without a directory stream; the next
        // context change rebuilds it.
      }
    }
    const subscription = await subscribeToServerEvents(
      serverId,
      () => getServerProjectState(serverId).current ?? undefined,
    );
    if (version !== rebuildVersion) {
      await subscription.unsubscribe();
      return;
    }
    sse = subscription;
    void subscription.sync().catch(() => {
      // A failed re-sync must not break the stream; the next context
      // change (or a server.connected event) heals the stores.
    });
  }

  createEffect(() => {
    const serverId = registry.activeServerId;
    const directory =
      serverId === null ? undefined : (getServerProjectState(serverId).current ?? undefined);
    const version = ++rebuildVersion;
    void rebuild(serverId, directory, version);
  });

  onCleanup(() => {
    rebuildVersion += 1;
    const current = sse;
    sse = undefined;
    if (current) void current.unsubscribe();
  });

  onMount(() => {
    setActiveServer(props.server.id);
    window.addEventListener("keydown", onKeyDown);
    void refresh();
    const stopHealth = subscribeToServerHealth();
    const stopChanged = subscribeToServersChanged((entries) => setServers(entries));
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      stopHealth();
      stopChanged();
      setActiveServer(null);
    });
  });

  const activeServer = (): ServerEntry =>
    servers().find((entry) => entry.id === registry.activeServerId) ?? props.server;

  return (
    <div class="flex h-screen min-h-0 bg-bg-base text-fg-primary" data-testid="desktop-shell">
      <nav
        class="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-bg-sunken bg-bg-elevated py-3"
        data-testid="rail"
      >
        <For each={servers()}>
          {(entry) => {
            const active = () => registry.activeServerId === entry.id;
            const kind = () => healthKind(entry);
            return (
              <button
                type="button"
                data-testid={`rail-item-${entry.id}`}
                data-active={active() ? "true" : "false"}
                aria-label={`Switch to ${entry.name}`}
                title={entry.name}
                class="outline-none"
                onClick={() => setActiveServer(entry.id)}
              >
                <span
                  class={`relative flex h-10 w-10 items-center justify-center rounded-full border bg-bg-sunken text-sm font-medium transition-colors ${
                    active()
                      ? "border-accent text-fg-primary"
                      : "border-transparent text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  {entry.name.charAt(0)}
                  <span
                    data-testid="rail-dot"
                    data-status={kind()}
                    class={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-elevated ${dotClass[kind()]}`}
                  />
                </span>
              </button>
            );
          }}
        </For>
        <button
          type="button"
          data-testid="rail-add"
          aria-label="Add server"
          title="Add server"
          class="mt-2 flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-fg-faint text-lg text-fg-secondary transition-colors hover:text-fg-primary"
          onClick={() => props.onExit()}
        >
          +
        </button>
      </nav>

      <aside class="flex w-64 shrink-0 flex-col border-r border-bg-sunken bg-bg-elevated">
        <header class="flex items-center justify-between gap-2 border-b border-bg-sunken px-4 py-3">
          <h1 data-testid="sidebar-server-name" class="truncate text-sm font-semibold">
            {activeServer().name}
          </h1>
          <button
            type="button"
            data-testid="back-to-servers"
            class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary hover:text-fg-primary"
            onClick={() => props.onExit()}
          >
            Back to servers
          </button>
        </header>
        <ProjectSwitcher serverId={activeServerId()} />
        <SessionList serverId={activeServerId()} onSelect={() => undefined} />
      </aside>

      <main class="flex min-w-0 flex-1 flex-col">
        <Show
          when={activeSessionId()}
          fallback={
            <div class="flex flex-1 items-center justify-center p-4">
              <p class="text-sm text-fg-secondary">Select a session — M2</p>
            </div>
          }
        >
          <header class="flex shrink-0 items-center justify-between gap-2 border-b border-bg-sunken px-4 py-2">
            <h2 data-testid="chat-session-title" class="min-w-0 truncate text-sm font-semibold">
              {titleOf(activeServerId(), activeSessionId() as string)}
            </h2>
            <button
              type="button"
              data-testid="todo-toggle"
              aria-pressed={todosOpen() ? "true" : "false"}
              aria-label="Toggle todo panel"
              class={`shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                todosOpen()
                  ? "border-accent text-accent"
                  : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
              }`}
              onClick={() => setTodosOpen((open) => !open)}
            >
              Todos
            </button>
          </header>
          <MessageList serverId={activeServerId()} sessionId={activeSessionId() as string} />
          <SessionErrorBanner serverId={activeServerId()} sessionId={activeSessionId() as string} />
          <PromptBox serverId={activeServerId()} sessionId={activeSessionId() as string} />
        </Show>
      </main>

      {/* Todo drawer (TASK-M3-07): fixed right-side overlay panel with a
          backdrop; Esc and backdrop clicks close it (mobile bottom sheet
          lands in M7). */}
      <Show when={todosOpen() && activeSessionId()}>
        <div
          data-testid="todo-drawer-backdrop"
          class="fixed inset-0 z-40 bg-black/40"
          onClick={closeTodos}
        />
        <aside
          data-testid="todo-drawer"
          class="fixed right-0 top-0 z-50 flex h-full w-[280px] flex-col border-l border-bg-sunken bg-bg-elevated shadow-lg"
        >
          <header class="flex shrink-0 items-center justify-between border-b border-bg-sunken px-4 py-3">
            <h2 class="text-sm font-semibold">Todos</h2>
            <button
              type="button"
              data-testid="todo-drawer-close"
              aria-label="Close todo panel"
              class="flex h-6 w-6 items-center justify-center rounded-md text-fg-secondary hover:bg-bg-sunken hover:text-fg-primary"
              onClick={closeTodos}
            >
              ✕
            </button>
          </header>
          <TodoPanel serverId={activeServerId()} sessionId={activeSessionId() as string} />
        </aside>
      </Show>
    </div>
  );
};

export default DesktopShell;
