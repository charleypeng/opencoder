// Server navigation home (TASK-M1-06): the app landing page. Shows the saved
// server registry as a responsive card grid with live per-server health
// (status dot, version, latency from the connection store), a right-click
// context menu (and a menu button) for edit / reconnect / delete, and an
// empty state that guides to the Add Server wizard. Clicking a card hands
// the server to the parent (workspace shell lands in M1-08).

import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import { ContextMenu, Dialog, DropdownMenu } from "@kobalte/core";
import AddServer from "./AddServer";
import ReauthDialog from "./ReauthDialog";
import ErrorBanner from "../../components/ErrorBanner";
import { formatRelativeTime } from "./relativeTime";
import { ApiError, isAuthError } from "../../services/errors";
import { subscribeToServersChanged } from "../../services/events";
import {
  listServers,
  probeServer,
  removeServer,
  startHealthMonitoring,
  updateServer,
} from "../../services/servers";
import type { AuthCredentials, ServerEntry } from "../../services/servers";
import { applyServerHealth, connections, subscribeToServerHealth } from "../../stores/connection";

export interface ServerHomeProps {
  /** Called when a server card is opened; the workspace lands in M1-08. */
  onSelect: (server: ServerEntry) => void;
}

type HealthKind = "ok" | "slow" | "down" | "unknown";

const dotClass: Record<HealthKind, string> = {
  ok: "bg-success",
  slow: "bg-warning",
  down: "bg-danger",
  unknown: "bg-fg-faint",
};

const statusLabel: Record<HealthKind, string> = {
  ok: "Online",
  slow: "Slow",
  down: "Offline",
  unknown: "Unknown",
};

interface MenuActions {
  onEdit: (server: ServerEntry) => void;
  onReconnect: (server: ServerEntry) => void;
  onDelete: (server: ServerEntry) => void;
}

/** Live status of a server card; unknown until the first health snapshot. */
function healthKind(server: ServerEntry): HealthKind {
  return connections[server.id]?.status ?? "unknown";
}

/** "version · latency ms" line, or an empty string before the first snapshot. */
function healthMeta(server: ServerEntry): string {
  const health = connections[server.id];
  if (!health) return "";
  const parts: string[] = [];
  if (health.version) parts.push(health.version);
  if (health.latencyMs !== undefined) parts.push(`${health.latencyMs} ms`);
  return parts.join(" · ");
}

/** Minimal menu-item contract shared by ContextMenu.Item and DropdownMenu.Item. */
type MenuItemComponent = Component<{
  onSelect?: () => void;
  class?: string;
  children?: JSX.Element;
}>;

/** Shared menu items for the context menu and the card menu button. */
function serverMenuItems(
  server: ServerEntry,
  Item: MenuItemComponent,
  actions: MenuActions,
): JSX.Element {
  return (
    <>
      <Item
        class="rounded-sm px-3 py-1.5 text-sm text-fg-primary outline-none hover:bg-accent-soft focus:bg-accent-soft data-[highlighted]:bg-accent-soft"
        onSelect={() => actions.onEdit(server)}
      >
        Edit
      </Item>
      <Item
        class="rounded-sm px-3 py-1.5 text-sm text-fg-primary outline-none hover:bg-accent-soft focus:bg-accent-soft data-[highlighted]:bg-accent-soft"
        onSelect={() => actions.onReconnect(server)}
      >
        Reconnect
      </Item>
      <Item
        class="rounded-sm px-3 py-1.5 text-sm text-danger outline-none hover:bg-accent-soft focus:bg-accent-soft data-[highlighted]:bg-accent-soft"
        onSelect={() => actions.onDelete(server)}
      >
        Delete
      </Item>
    </>
  );
}

function EmptyState(props: { onAdd: () => void }) {
  return (
    <div
      data-testid="empty-state"
      class="mx-auto max-w-md rounded-md border border-bg-sunken bg-bg-elevated p-8 text-center"
    >
      <h2 class="text-lg font-semibold">No servers yet</h2>
      <p class="mt-2 text-sm text-fg-secondary">
        Add your first OpenCode server to chat with it from this client.
      </p>
      <button
        data-testid="add-first-server"
        type="button"
        class="mt-5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
        onClick={() => props.onAdd()}
      >
        Add your first server
      </button>
    </div>
  );
}

const cardActionClass =
  "rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm " +
  "text-fg-secondary hover:text-fg-primary";

function ServerHome(props: ServerHomeProps) {
  const [servers, setServers] = createSignal<ServerEntry[]>([]);
  const [loadError, setLoadError] = createSignal<ApiError | null>(null);
  const [bannerError, setBannerError] = createSignal<ApiError | null>(null);
  const [adding, setAdding] = createSignal(false);
  const [editing, setEditing] = createSignal<ServerEntry | null>(null);
  const [deleting, setDeleting] = createSignal<ServerEntry | null>(null);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);
  const [reauthServer, setReauthServer] = createSignal<ServerEntry | null>(null);
  const [reauthReason, setReauthReason] = createSignal<ApiError | null>(null);

  async function refresh() {
    try {
      setServers(await listServers());
      setLoadError(null);
    } catch (err) {
      setLoadError(ApiError.fromUnknown(err));
    }
  }

  onMount(() => {
    void refresh();
    const stopHealth = subscribeToServerHealth();
    const stopChanged = subscribeToServersChanged((entries) => setServers(entries));
    onCleanup(() => {
      stopHealth();
      stopChanged();
    });
  });

  function startAdd() {
    setEditing(null);
    setAdding(true);
  }

  async function reconnect(server: ServerEntry) {
    const auth =
      server.username || server.password
        ? { username: server.username, password: server.password }
        : undefined;
    try {
      const health = await probeServer(server.url, auth);
      applyServerHealth({ ...health, serverId: server.id });
      setBannerError(null);
    } catch (err) {
      const apiErr = ApiError.fromUnknown(err);
      if (isAuthError(apiErr)) {
        // A 401 means the saved credentials were rejected: ask for new ones
        // instead of surfacing a plain banner.
        setReauthReason(apiErr);
        setReauthServer(server);
        return;
      }
      setBannerError(apiErr);
      return;
    }
    try {
      await startHealthMonitoring(server.id);
    } catch {
      // The monitor may already be running; nothing to do.
    }
  }

  /**
   * Re-auth retry (TASK-M1-09): verifies the entered credentials with a
   * probe first and only persists them (update_server) once the probe
   * succeeded — rejected credentials never touch the store. Rejects with
   * the probe's ApiError when verification fails.
   */
  async function retryAuth(credentials: AuthCredentials) {
    const server = reauthServer();
    if (!server) return;
    const health = await probeServer(server.url, credentials);
    // The dialog may have been dismissed (Esc / overlay) while the probe
    // was in flight: Cancel is authoritative, so a stale continuation must
    // not persist credentials or refresh behind the closed dialog.
    if (reauthServer() !== server) return;
    await updateServer(server.id, {
      name: server.name,
      url: server.url,
      username: credentials.username,
      password: credentials.password,
    });
    applyServerHealth({ ...health, serverId: server.id });
    try {
      await startHealthMonitoring(server.id);
    } catch {
      // The monitor may already be running; nothing to do.
    }
    setReauthServer(null);
    setReauthReason(null);
    setBannerError(null);
    void refresh();
  }

  async function confirmDelete() {
    const server = deleting();
    if (!server) return;
    try {
      await removeServer(server.id);
      setDeleting(null);
      setDeleteError(null);
    } catch (err) {
      setDeleteError(ApiError.fromUnknown(err).message);
    }
  }

  const menuActions = (): MenuActions => ({
    onEdit: (entry) => {
      setAdding(false);
      setEditing(entry);
    },
    onReconnect: (entry) => void reconnect(entry),
    onDelete: (entry) => {
      setDeleteError(null);
      setDeleting(entry);
    },
  });

  function renderGrid(): JSX.Element {
    return (
      <div
        data-testid="server-grid"
        class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4"
      >
        <For each={servers()}>
          {(server) => {
            const kind = () => healthKind(server);
            const actions = menuActions();
            return (
              <ContextMenu.Root>
                <ContextMenu.Trigger as="div" class="h-full">
                  <div
                    data-testid={`server-card-${server.id}`}
                    role="button"
                    tabindex="0"
                    class="flex h-full cursor-pointer flex-col gap-3 rounded-md border border-bg-sunken bg-bg-elevated p-4 transition-colors hover:border-fg-faint focus:border-accent focus:outline-none"
                    onClick={() => props.onSelect(server)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        props.onSelect(server);
                      }
                    }}
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="truncate text-sm font-medium">{server.name}</p>
                        <p class="truncate font-code text-xs text-fg-secondary">{server.url}</p>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        <span
                          data-testid="status-dot"
                          data-status={kind()}
                          title={statusLabel[kind()]}
                          class={`h-2 w-2 rounded-full ${dotClass[kind()]}`}
                        />
                        <div onClick={(event) => event.stopPropagation()}>
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger
                              as="button"
                              type="button"
                              data-testid={`server-menu-${server.id}`}
                              aria-label={`Actions for ${server.name}`}
                              class="rounded-md px-1.5 py-0.5 text-sm text-fg-faint hover:text-fg-secondary"
                            >
                              ⋯
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content class="glass z-50 min-w-40 p-1">
                                {serverMenuItems(server, DropdownMenu.Item, actions)}
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        </div>
                      </div>
                    </div>
                    <div class="mt-auto flex items-center justify-between gap-2 text-xs text-fg-secondary">
                      <span data-testid="health-meta" class="truncate">
                        {healthMeta(server)}
                      </span>
                      <span data-testid="last-connected" class="shrink-0">
                        {server.lastConnectedAt !== undefined
                          ? `Last connected ${formatRelativeTime(server.lastConnectedAt)}`
                          : "Never connected"}
                      </span>
                    </div>
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content class="glass z-50 min-w-40 p-1">
                    {serverMenuItems(server, ContextMenu.Item, actions)}
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            );
          }}
        </For>
      </div>
    );
  }

  return (
    <div class="min-h-screen bg-bg-base text-fg-primary" data-testid="server-home">
      <header class="glass sticky top-0 z-10 flex items-center justify-between px-6 py-4">
        <div>
          <h1 class="text-lg font-semibold">opencode-client</h1>
          <p class="text-sm text-fg-secondary">Servers</p>
        </div>
        <button
          data-testid="add-server-btn"
          type="button"
          class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
          onClick={startAdd}
        >
          Add server
        </button>
      </header>

      <main class="mx-auto max-w-5xl px-6 py-8">
        <Show when={loadError()}>
          <ErrorBanner error={loadError()} onDismiss={() => setLoadError(null)} />
        </Show>
        <Show when={bannerError()}>
          <ErrorBanner error={bannerError()} onDismiss={() => setBannerError(null)} />
        </Show>
        <Show
          when={adding() || editing()}
          fallback={
            <Show when={servers().length === 0} fallback={renderGrid()}>
              <EmptyState onAdd={startAdd} />
            </Show>
          }
        >
          <div class="mx-auto max-w-xl">
            <Show when={editing()} keyed>
              {(entry) => (
                <AddServer
                  server={entry}
                  onAdded={() => {
                    setEditing(null);
                    void refresh();
                  }}
                />
              )}
            </Show>
            <Show when={adding() && !editing()}>
              <AddServer
                onAdded={() => {
                  setAdding(false);
                  void refresh();
                }}
              />
            </Show>
            <button
              data-testid="wizard-back"
              type="button"
              class={`${cardActionClass} mt-4`}
              onClick={() => {
                setAdding(false);
                setEditing(null);
              }}
            >
              Back to servers
            </button>
          </div>
        </Show>
      </main>

      <Dialog.Root
        open={deleting() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content
            data-testid="delete-dialog"
            class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-6"
          >
            <Dialog.Title class="text-md font-semibold">Delete server?</Dialog.Title>
            <Dialog.Description class="mt-1 text-sm text-fg-secondary">
              Remove {deleting()?.name} from the list? Sessions stay on the server.
            </Dialog.Description>
            <Show when={deleteError()}>
              <p class="mt-2 text-sm text-danger" data-testid="delete-error">
                {deleteError()}
              </p>
            </Show>
            <div class="mt-5 flex justify-end gap-3">
              <Dialog.CloseButton class={cardActionClass}>Cancel</Dialog.CloseButton>
              <button
                data-testid="confirm-delete"
                type="button"
                class="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white"
                onClick={() => void confirmDelete()}
              >
                Delete
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Show when={reauthServer()} keyed>
        {(reauthEntry) => (
          <ReauthDialog
            server={reauthEntry}
            reason={reauthReason()}
            onSubmit={(credentials) => retryAuth(credentials)}
            onCancel={() => {
              setReauthServer(null);
              setReauthReason(null);
            }}
          />
        )}
      </Show>
    </div>
  );
}

export default ServerHome;
