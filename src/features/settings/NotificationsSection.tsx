// Notifications settings section (TASK-M8-06): the do-not-disturb master
// switch plus one toggle per server. Everything is persisted to
// localStorage (`oc-notifications`, stores/notifications.ts) and read at
// notification fire time by the notificationEvents watcher, so the
// toggles take effect immediately. The switches mirror the stored state
// (absent fields mean ON), and storage failures are swallowed by the
// store — no inline error UI is needed (unlike the Rust-backed desktop
// section).

import { createEffect, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { listServers } from "../../services/servers.js";
import type { ServerEntry } from "../../services/servers.js";
import { useT } from "../../i18n/index.js";
import {
  loadNotificationPrefs,
  notificationsEnabled,
  serverNotificationsEnabled,
  setNotificationsEnabled,
  setServerNotificationsEnabled,
} from "../../stores/notifications.js";

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

const NotificationsSection: Component = () => {
  const t = useT();
  const [enabled, setEnabled] = createSignal(notificationsEnabled());
  const [perServer, setPerServer] = createSignal(loadNotificationPrefs().perServer ?? {});
  const [servers, setServers] = createSignal<ServerEntry[]>([]);

  // One-shot server list load (the server registry is the same source the
  // rail uses; a failure keeps the master switch only).
  createEffect(() => {
    void listServers()
      .then(setServers)
      .catch(() => {
        // Unreachable registry: the per-server toggles stay hidden.
      });
  });

  function toggleServer(serverId: string, next: boolean) {
    setServerNotificationsEnabled(serverId, next);
    setPerServer({ ...perServer(), [serverId]: next });
  }

  return (
    <div data-testid="notifications-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("settings:notifications")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:notificationsHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">{t("settings:notifications")}</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:notificationsHintFull")}</p>
          </div>
          <ToggleSwitch
            testId="notifications-master"
            label={t("settings:notifications")}
            checked={enabled()}
            onToggle={(next) => {
              setNotificationsEnabled(next);
              setEnabled(next);
            }}
          />
        </div>
        <Show when={servers().length > 0}>
          <p class="pb-1 pt-3 text-xs font-medium">{t("settings:perServer")}</p>
          <For each={servers()}>
            {(entry) => (
              <div
                class="flex items-center justify-between gap-3 border-b border-bg-sunken py-2.5"
                data-testid={`notifications-server-${entry.id}`}
              >
                <p class="min-w-0 truncate text-xs text-fg-secondary">{entry.name}</p>
                <ToggleSwitch
                  testId={`notifications-server-${entry.id}-toggle`}
                  label={t("settings:notificationsFor", { name: entry.name })}
                  checked={serverNotificationsEnabled(entry.id, { perServer: perServer() })}
                  onToggle={(next) => toggleServer(entry.id, next)}
                />
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};

export default NotificationsSection;
