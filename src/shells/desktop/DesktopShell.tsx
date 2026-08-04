// Desktop workspace shell (TASK-M1-08): the three-column skeleton (Rail |
// Sidebar | Main) mounted when a server is opened from ServerHome. Mounting
// sets the active server context (registry store); unmounting clears it and
// tears down that server's SSE stream. The rail mirrors the server list
// (listServers + servers-changed) with a health dot per server and offers
// ⌘/Ctrl+1..9 switching in list order. The sidebar holds the project/folder
// switcher (TASK-M2-03) on top and the session list (TASK-M2-04) below; the
// main pane shows the selected session id until the chat view lands in
// M2-06/08. This shell owns the per-directory SSE subscription and rebuilds
// it whenever the active server or the active directory changes, re-syncing
// the stores so sessions and messages never mix across contexts.

import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { subscribeToServersChanged } from "../../services/events";
import { listServers } from "../../services/servers";
import type { ServerEntry } from "../../services/servers";
import { getApiClient } from "../../services/client";
import { createProjectService } from "../../services/project";
import { connections, subscribeToServerHealth } from "../../stores/connection";
import { registry, setActiveServer } from "../../stores/registry";
import { getServerProjectState } from "../../stores/project";
import { resetServer as resetSessions } from "../../stores/session";
import { resetServer as resetMessages } from "../../stores/messages";
import { subscribeToServerEvents, type SubscribeToServerEventsResult } from "../../stores/events";
import ProjectSwitcher from "../../features/sessions/ProjectSwitcher";
import SessionList from "../../features/sessions/SessionList";

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

const DesktopShell: Component<DesktopShellProps> = (props) => {
  const [servers, setServers] = createSignal<ServerEntry[]>([]);
  // Main-pane placeholder target: echoes the selected session id until the
  // chat view lands in M2-06/08. Reset on server switch so the placeholder
  // never shows a session from another server's context.
  const [selectedSession, setSelectedSession] = createSignal<string | null>(null);

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
    // Drop the previous context's sessions and messages so the new
    // directory's data can never mix with the old one; the re-sync
    // re-applies fresh snapshots right after the stream is up.
    resetSessions(serverId);
    resetMessages(serverId);
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
    if (serverId !== props.server.id) setSelectedSession(null);
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
        <ProjectSwitcher serverId={registry.activeServerId ?? props.server.id} />
        <SessionList
          serverId={registry.activeServerId ?? props.server.id}
          onSelect={setSelectedSession}
        />
      </aside>

      <main class="flex min-w-0 flex-1 flex-col">
        <Show
          when={selectedSession()}
          fallback={
            <div class="flex flex-1 items-center justify-center p-4">
              <p class="text-sm text-fg-secondary">Select a session — M2</p>
            </div>
          }
        >
          <div class="flex flex-1 items-center justify-center p-4">
            <p
              data-testid="main-selected-session"
              class="truncate font-code text-sm text-fg-secondary"
            >
              {selectedSession()}
            </p>
          </div>
        </Show>
      </main>
    </div>
  );
};

export default DesktopShell;
