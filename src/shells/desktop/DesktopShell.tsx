// Desktop workspace shell (TASK-M1-08): the three-column skeleton (Rail |
// Sidebar | Main) mounted when a server is opened from ServerHome. Mounting
// sets the active server context (registry store); unmounting clears it and
// is the hook point for disconnecting that server's SSE stream (M2). The
// rail mirrors the server list (listServers + servers-changed) with a health
// dot per server and offers ⌘/Ctrl+1..9 switching in list order.

import { createSignal, For, onCleanup, onMount } from "solid-js";
import type { Component } from "solid-js";
import { subscribeToServersChanged } from "../../services/events";
import { listServers } from "../../services/servers";
import type { ServerEntry } from "../../services/servers";
import { connections, subscribeToServerHealth } from "../../stores/connection";
import { registry, setActiveServer } from "../../stores/registry";

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
      // M2 hook point: unsubscribe this server's SSE stream (sseUnsubscribe)
      // before clearing the active context so events never cross servers.
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
        <div class="flex flex-1 items-center justify-center p-4">
          <p class="text-sm text-fg-secondary">Chat sessions — M2</p>
        </div>
      </aside>

      <main class="flex min-w-0 flex-1 flex-col">
        <div class="flex flex-1 items-center justify-center p-4">
          <p class="text-sm text-fg-secondary">Select a session — M2</p>
        </div>
      </main>
    </div>
  );
};

export default DesktopShell;
