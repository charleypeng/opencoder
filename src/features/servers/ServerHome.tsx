// Server navigation home (TASK-M1-06): the app landing page. Shows the saved
// server registry as a responsive card grid with live per-server health
// (status dot, version, latency from the connection store), a right-click
// context menu (and a menu button) for edit / reconnect / delete, and an
// empty state that guides to the Add Server wizard. Clicking a card hands
// the server to the parent (workspace shell lands in M1-08).

import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import { ContextMenu, Dialog, DropdownMenu } from "@kobalte/core";
import AddServer from "./AddServer";
import ReauthDialog from "./ReauthDialog";
import ServerOAuthDialog from "./ServerOAuthDialog";
import ServerQrDialog from "./ServerQrDialog";
import ErrorBanner from "../../components/ErrorBanner";
import { useT } from "../../i18n";
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
import { clearDefaultWorkspace } from "./defaultWorkspace";
import { clearRecentProjects } from "../sessions/recentProjects";
import { clearWorkspaces } from "../sessions/workspaces";
import { platform } from "../../platform/index.js";

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

const statusLabelKey: Record<HealthKind, string> = {
  ok: "servers:statusOnline",
  slow: "servers:statusSlow",
  down: "servers:statusOffline",
  unknown: "servers:statusUnknown",
};

interface MenuActions {
  onShowQr: (server: ServerEntry) => void;
  onEdit: (server: ServerEntry) => void;
  onReconnect: (server: ServerEntry) => void;
  onReauth: (server: ServerEntry) => void;
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
  t: (key: string) => string,
): JSX.Element {
  return (
    <>
      <Show when={platform.kind === "desktop"}>
        {/* The QR share dialog is a desktop feature; the mobile card menu
            must not offer it (mobile sharing is the native share sheet). */}
        <Item
          class="rounded-sm px-3 py-1.5 text-sm text-fg-primary outline-none hover:bg-accent-soft focus:bg-accent-soft data-[highlighted]:bg-accent-soft"
          onSelect={() => actions.onShowQr(server)}
        >
          {t("servers:showQrCode")}
        </Item>
      </Show>
      <Item
        class="rounded-sm px-3 py-1.5 text-sm text-fg-primary outline-none hover:bg-accent-soft focus:bg-accent-soft data-[highlighted]:bg-accent-soft"
        onSelect={() => actions.onEdit(server)}
      >
        {t("servers:edit")}
      </Item>
      <Item
        class="rounded-sm px-3 py-1.5 text-sm text-fg-primary outline-none hover:bg-accent-soft focus:bg-accent-soft data-[highlighted]:bg-accent-soft"
        onSelect={() => actions.onReconnect(server)}
      >
        {t("servers:reconnect")}
      </Item>
      {/* OAuth servers get a dedicated re-authentication entry (TASK-UI-01):
          the consent flow re-runs; Basic servers keep "Reconnect" as their
          only credential path (a 401 there opens the credentials form). */}
      <Show when={server.oauth !== undefined}>
        <Item
          class="rounded-sm px-3 py-1.5 text-sm text-fg-primary outline-none hover:bg-accent-soft focus:bg-accent-soft data-[highlighted]:bg-accent-soft"
          onSelect={() => actions.onReauth(server)}
        >
          {t("servers:reauthenticate")}
        </Item>
      </Show>
      <Item
        class="rounded-sm px-3 py-1.5 text-sm text-danger outline-none hover:bg-accent-soft focus:bg-accent-soft data-[highlighted]:bg-accent-soft"
        onSelect={() => actions.onDelete(server)}
      >
        {t("servers:delete")}
      </Item>
    </>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <div data-testid="empty-state" class="mx-auto mt-4 max-w-md text-center">
      <p class="text-sm font-medium text-fg-secondary">{t("servers:noServers")}</p>
      <p class="mt-1 text-sm text-fg-faint">{t("servers:noServersHint")}</p>
    </div>
  );
}

const cardActionClass =
  "rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm " +
  "text-fg-secondary hover:text-fg-primary";

function ServerHome(props: ServerHomeProps) {
  const t = useT();
  const [servers, setServers] = createSignal<ServerEntry[]>([]);
  const [loadError, setLoadError] = createSignal<ApiError | null>(null);
  const [bannerError, setBannerError] = createSignal<ApiError | null>(null);
  const [adding, setAdding] = createSignal(false);
  const [editing, setEditing] = createSignal<ServerEntry | null>(null);
  const [deleting, setDeleting] = createSignal<ServerEntry | null>(null);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);
  const [reauthServer, setReauthServer] = createSignal<ServerEntry | null>(null);
  const [reauthReason, setReauthReason] = createSignal<ApiError | null>(null);
  const [oauthServer, setOauthServer] = createSignal<ServerEntry | null>(null);
  const [qrServer, setQrServer] = createSignal<ServerEntry | null>(null);

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

  // TASK-UI-01: auto re-authentication. The health monitor flags a probe
  // rejected with 401/403 (`authRequired`); when the flagged server has
  // stored OAuth credentials the consent dialog opens once so the user can
  // re-authorize — the dialog's success restarts the monitor with the
  // fresh token. Basic-auth servers keep the manual flow (Reconnect → 401
  // opens the credentials form).
  createEffect(() => {
    const entry = servers().find(
      (candidate) => candidate.oauth && connections[candidate.id]?.authRequired,
    );
    if (entry && oauthServer() === null) {
      setOauthServer(entry);
    }
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
        // A 401 means the saved credentials were rejected: servers with
        // OAuth credentials go through the consent flow again, others ask
        // for new Basic credentials.
        if (server.oauth) {
          setOauthServer(server);
        } else {
          setReauthReason(apiErr);
          setReauthServer(server);
        }
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

  /**
   * OAuth re-auth completion (TASK-UI-01): tokens are stored by the Rust
   * exchange; the entry refresh picks up the new oauth field, the health
   * monitor restarts so the next probe uses the fresh token, and the
   * banner clears.
   */
  async function onOAuthAuthorized() {
    const server = oauthServer();
    if (!server) return;
    setBannerError(null);
    try {
      await startHealthMonitoring(server.id);
    } catch {
      // The monitor may already be running; nothing to do.
    }
    setOauthServer(null);
    void refresh();
  }

  async function confirmDelete() {
    const server = deleting();
    if (!server) return;
    try {
      await removeServer(server.id);
      // Bug 3: drop the server's local workspace memory so re-adding the
      // same server starts fresh (no stale default/explicit/recent list).
      clearWorkspaces(server.id);
      clearDefaultWorkspace(server.id);
      clearRecentProjects(server.id);
      setDeleting(null);
      setDeleteError(null);
    } catch (err) {
      setDeleteError(ApiError.fromUnknown(err).message);
    }
  }

  const menuActions = (): MenuActions => ({
    onShowQr: (entry) => setQrServer(entry),
    onEdit: (entry) => {
      setAdding(false);
      setEditing(entry);
    },
    onReconnect: (entry) => void reconnect(entry),
    // Manual re-authentication: OAuth servers open the consent dialog;
    // Basic-auth servers verify new credentials through the reauth form.
    onReauth: (entry) => {
      if (entry.oauth) {
        setOauthServer(entry);
        setReauthServer(null);
      } else {
        setReauthServer(entry);
        setOauthServer(null);
      }
    },
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
        <button
          data-testid={servers().length === 0 ? "add-first-server" : "add-server-card"}
          type="button"
          class="flex min-h-44 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-bg-sunken bg-bg-elevated p-4 text-fg-secondary transition-colors hover:border-accent hover:text-fg-primary"
          onClick={startAdd}
        >
          <span class="text-5xl font-light leading-none" aria-hidden="true">
            +
          </span>
          <span class="text-sm font-medium">{t("servers:addServer")}</span>
        </button>
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
                          title={t(statusLabelKey[kind()])}
                          class={`h-2 w-2 rounded-full ${dotClass[kind()]}`}
                        />
                        <div onClick={(event) => event.stopPropagation()}>
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger
                              as="button"
                              type="button"
                              data-testid={`server-menu-${server.id}`}
                              aria-label={t("servers:actionsFor", { name: server.name })}
                              class="rounded-md px-1.5 py-0.5 text-sm text-fg-faint hover:text-fg-secondary"
                            >
                              ⋯
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content class="glass z-50 min-w-40 p-1">
                                {serverMenuItems(server, DropdownMenu.Item, actions, t)}
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
                          ? t("servers:lastConnected", {
                              time: formatRelativeTime(server.lastConnectedAt),
                            })
                          : t("servers:neverConnected")}
                      </span>
                    </div>
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content class="glass z-50 min-w-40 p-1">
                    {serverMenuItems(server, ContextMenu.Item, actions, t)}
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
    // TASK-M7-04: min-h-full + pb-safe keep the home clear of the notch /
    // home indicator on mobile (env() is 0 on desktop, so the classes are
    // desktop-neutral); the header's top/left/right padding grows by the
    // safe-area insets via max() so the sticky bar never sits under the
    // notch in portrait or landscape. TASK-M8-04: min-h-full (instead of
    // min-h-dvh) lets the page fill the App content wrapper below the
    // desktop TitleBar without overflowing it.
    <div class="min-h-full bg-bg-base pb-safe text-fg-primary" data-testid="server-home">
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
            <>
              {renderGrid()}
              <Show when={servers().length === 0}>
                <EmptyState />
              </Show>
            </>
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
                scanEnabled={platform.kind === "mobile"}
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
              {t("servers:backToServers")}
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
            <Dialog.Title class="text-md font-semibold">
              {t("servers:deleteServerTitle")}
            </Dialog.Title>
            <Dialog.Description class="mt-1 text-sm text-fg-secondary">
              {t("servers:deleteServerBody", { name: deleting()?.name ?? "" })}
            </Dialog.Description>
            <Show when={deleteError()}>
              <p class="mt-2 text-sm text-danger" data-testid="delete-error">
                {deleteError()}
              </p>
            </Show>
            <div class="mt-5 flex justify-end gap-3">
              <Dialog.CloseButton class={cardActionClass}>{t("common:cancel")}</Dialog.CloseButton>
              <button
                data-testid="confirm-delete"
                type="button"
                class="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white"
                onClick={() => void confirmDelete()}
              >
                {t("servers:delete")}
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

      {/* OAuth consent dialog (TASK-UI-01): opened by the card menu's
          "Re-authenticate", by a 401 on a server with OAuth credentials,
          and by the Add Server flow once the server is saved. */}
      <Show when={oauthServer()} keyed>
        {(oauthEntry) => (
          <ServerOAuthDialog
            serverId={oauthEntry.id}
            serverName={oauthEntry.name}
            onClose={() => setOauthServer(null)}
            onAuthorized={() => void onOAuthAuthorized()}
          />
        )}
      </Show>

      <Show when={qrServer()} keyed>
        {(entry) => <ServerQrDialog server={entry} onClose={() => setQrServer(null)} />}
      </Show>
    </div>
  );
}

export default ServerHome;
