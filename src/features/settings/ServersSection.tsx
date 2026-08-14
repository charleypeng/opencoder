// Servers settings section (TASK-M9-04): every saved server with its live
// health status, a per-server notification switch (stores/notifications,
// `oc-notifications`) and a per-server theme override quick-set
// (stores/theme, `oc-theme-server`) — the same stores the Notifications
// and Appearance sections edit, listed here for all servers at once. The
// registry list comes from listServers() and follows servers-changed
// events; notification prefs are re-read on every toggle so the switches
// always mirror the persisted store.

import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { Component } from "solid-js";
import { listServers } from "../../services/servers.js";
import type { ServerEntry } from "../../services/servers.js";
import { subscribeToServersChanged } from "../../services/events.js";
import { connections } from "../../stores/connection.js";
import {
  loadNotificationPrefs,
  serverNotificationsEnabled,
  setServerNotificationsEnabled,
} from "../../stores/notifications.js";
import type { NotificationPrefs } from "../../stores/notifications.js";
import {
  THEME_MODES,
  clearServerThemeOverride,
  serverThemeOverride,
  setServerThemeOverride,
} from "../../stores/theme.js";
import type { ThemeMode } from "../../stores/theme.js";
import { readDefaultWorkspace, setDefaultWorkspace } from "../servers/defaultWorkspace.js";
import DirectoryPickerDialog from "../sessions/DirectoryPickerDialog.js";
import { useT } from "../../i18n/index.js";

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

/** i18n key of a theme mode label (settings:themeDark / themeLight /
 *  themeSystem). */
function modeKey(mode: ThemeMode): string {
  return `settings:theme${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
}

function ToggleSwitch(props: {
  testId: string;
  label: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      data-testid={props.testId}
      aria-checked={props.checked ? "true" : "false"}
      aria-label={props.label}
      onClick={() => props.onToggle(!props.checked)}
      class={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors ${
        props.checked ? "bg-accent" : "bg-bg-sunken"
      }`}
    >
      <span
        class={`absolute top-0.5 h-5 w-5 rounded-full bg-fg-primary transition-transform ${
          props.checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/** Live status of a server row; unknown until the first health snapshot. */
function healthKind(server: ServerEntry): HealthKind {
  return connections[server.id]?.status ?? "unknown";
}

const ServersSection: Component = () => {
  const t = useT();
  const [servers, setServers] = createSignal<ServerEntry[]>([]);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [prefs, setPrefs] = createSignal<NotificationPrefs>(loadNotificationPrefs());
  // The server whose default-workspace picker is open (null = closed).
  const [pickerServer, setPickerServer] = createSignal<string | null>(null);
  // Reactive cache of the per-server default workspaces (localStorage reads
  // are non-reactive; picking a new one updates this map so the row refreshes).
  const [defaultWorkspaces, setDefaultWorkspaces] = createSignal<Record<string, string | null>>({});
  function workspaceOf(serverId: string): string | null {
    return defaultWorkspaces()[serverId] ?? readDefaultWorkspace(serverId) ?? null;
  }

  onMount(() => {
    void listServers()
      .then((entries) => setServers(entries ?? []))
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
    const stopChanged = subscribeToServersChanged((entries) => setServers(entries));
    onCleanup(stopChanged);
  });

  function toggleNotify(serverId: string, next: boolean) {
    setServerNotificationsEnabled(serverId, next);
    setPrefs(loadNotificationPrefs());
  }

  const overrideOf = (serverId: string): ThemeMode | undefined => serverThemeOverride(serverId);

  return (
    <div data-testid="servers-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("servers:servers")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:serversHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <Show when={loadError() !== null}>
          <p data-testid="servers-load-error" role="alert" class="pb-3 text-xs text-danger">
            {loadError()}
          </p>
        </Show>
        <Show when={servers().length === 0 && loadError() === null}>
          <p data-testid="servers-empty" class="text-xs text-fg-secondary">
            {t("servers:noServers")}
          </p>
        </Show>
        <For each={servers()}>
          {(server) => {
            // Read through functions called in JSX: body reads are not
            // tracked under the test transform, inline reads are.
            const kind = (): HealthKind => healthKind(server);
            const override = (): ThemeMode | undefined => overrideOf(server.id);
            return (
              <div data-testid={`servers-row-${server.id}`} class="border-b border-bg-sunken py-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <p class="flex items-center gap-2 truncate text-xs font-medium">
                      <span
                        data-testid="servers-status-dot"
                        data-status={kind()}
                        title={t(statusLabelKey[kind()])}
                        class={`h-2 w-2 shrink-0 rounded-full ${dotClass[kind()]}`}
                      />
                      {server.name}
                    </p>
                    <p class="mt-0.5 truncate font-code text-xs text-fg-secondary">{server.url}</p>
                  </div>
                  <ToggleSwitch
                    testId={`servers-notify-${server.id}`}
                    label={t("settings:notificationsFor", { name: server.name })}
                    checked={serverNotificationsEnabled(server.id, prefs())}
                    onToggle={(next) => toggleNotify(server.id, next)}
                  />
                </div>
                <div
                  data-testid={`servers-theme-${server.id}`}
                  class="mt-2 flex flex-wrap items-center gap-2"
                >
                  <span class="text-xs text-fg-secondary">{t("settings:serverTheme")}</span>
                  <button
                    type="button"
                    data-testid={`servers-theme-${server.id}-follow`}
                    aria-pressed={override() === undefined ? "true" : "false"}
                    onClick={() => clearServerThemeOverride(server.id)}
                    class={`rounded-md border px-2 py-1 text-xs outline-none transition-colors ${
                      override() === undefined
                        ? "border-accent bg-accent-soft text-fg-primary"
                        : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
                    }`}
                  >
                    {t("settings:followGlobal")}
                  </button>
                  <For each={THEME_MODES}>
                    {(mode) => (
                      <button
                        type="button"
                        data-testid={`servers-theme-${server.id}-${mode}`}
                        aria-pressed={override() === mode ? "true" : "false"}
                        onClick={() => setServerThemeOverride(server.id, mode)}
                        class={`rounded-md border px-2 py-1 text-xs outline-none transition-colors ${
                          override() === mode
                            ? "border-accent bg-accent-soft text-fg-primary"
                            : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
                        }`}
                      >
                        {t(modeKey(mode))}
                      </button>
                    )}
                  </For>
                </div>
                {/* Default workspace (feat(default-workspace)): the folder
                    the server lands in on entry; re-pickable here anytime. */}
                <div
                  data-testid={`servers-default-ws-${server.id}`}
                  class="mt-2 flex items-center gap-2"
                >
                  <span class="shrink-0 text-xs text-fg-secondary">
                    {t("settings:defaultWorkspaceCurrent")}
                  </span>
                  <span
                    data-testid="servers-default-ws-value"
                    title={workspaceOf(server.id) ?? undefined}
                    class={`min-w-0 flex-1 truncate font-code text-xs ${
                      workspaceOf(server.id) === null ? "text-fg-faint" : "text-fg-secondary"
                    }`}
                  >
                    {workspaceOf(server.id) ?? t("settings:defaultWorkspaceUnset")}
                  </span>
                  <button
                    type="button"
                    data-testid="servers-default-ws-change"
                    onClick={() => setPickerServer(server.id)}
                    class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary focus:text-fg-primary"
                  >
                    {t("settings:defaultWorkspaceChange")}
                  </button>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      {/* Default-workspace picker (feat(default-workspace)): re-picking the
          folder a server opens by default; the picker starts at the current
          default (or the root) and persists the choice on add. */}
      <Show when={pickerServer() !== null}>
        <DirectoryPickerDialog
          serverId={pickerServer()!}
          initialDirectory={workspaceOf(pickerServer()!) ?? undefined}
          onAdded={(directory) => {
            setDefaultWorkspace(pickerServer()!, directory);
            setDefaultWorkspaces({ ...defaultWorkspaces(), [pickerServer()!]: directory });
          }}
          onClose={() => setPickerServer(null)}
        />
      </Show>
    </div>
  );
};

export default ServersSection;
