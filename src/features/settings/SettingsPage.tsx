// Settings page (TASK-M5-06): the minimal settings skeleton hosting the
// provider API-key section (ProviderKeys) and, since TASK-M8-01, the
// shortcuts customization section. The section nav is a placeholder —
// M9-04 owns the full settings center and will expand the sections.
// DesktopShell mounts this view through its gear button; the header's Back
// returns to the previous main view.

import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import ProviderKeys from "./providers/ProviderKeys.js";
import ShortcutsSection from "./ShortcutsSection.js";
import DesktopSection from "./DesktopSection.js";
import NotificationsSection from "./NotificationsSection.js";
import UpdatesSection from "./UpdatesSection.js";
import LanguageSection from "./LanguageSection.js";
import AppearanceSection from "./AppearanceSection.js";
import { useT } from "../../i18n/index.js";

export interface SettingsPageProps {
  /** The server whose settings are shown. */
  serverId: string;
  /** Called by the header's Back button to leave the settings view. */
  onBack: () => void;
}

type SettingsSection =
  "providers" | "appearance" | "shortcuts" | "desktop" | "notifications" | "updates" | "language";

const SettingsPage: Component<SettingsPageProps> = (props) => {
  const t = useT();
  const [section, setSection] = createSignal<SettingsSection>("providers");

  return (
    <div data-testid="settings-page" class="flex h-full min-h-0 flex-col">
      <header class="flex shrink-0 items-center gap-2 border-b border-bg-sunken px-4 py-2">
        <button
          type="button"
          data-testid="settings-back"
          class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
          onClick={() => props.onBack()}
        >
          ← {t("common:back")}
        </button>
        <h2 class="shrink-0 text-sm font-semibold">{t("settings:settings")}</h2>
      </header>
      <div class="flex min-h-0 flex-1">
        <nav
          data-testid="settings-sections"
          class="flex w-40 shrink-0 flex-col gap-1 border-r border-bg-sunken p-2"
          aria-label={t("settings:sections")}
        >
          <button
            type="button"
            data-testid="settings-section-providers"
            data-active={section() === "providers" ? "true" : "false"}
            aria-selected={section() === "providers" ? "true" : "false"}
            class={`rounded-md px-3 py-1.5 text-left text-xs outline-none transition-colors ${
              section() === "providers"
                ? "bg-accent-soft text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
            onClick={() => setSection("providers")}
          >
            Providers
          </button>
          <button
            type="button"
            data-testid="settings-section-appearance"
            data-active={section() === "appearance" ? "true" : "false"}
            aria-selected={section() === "appearance" ? "true" : "false"}
            class={`rounded-md px-3 py-1.5 text-left text-xs outline-none transition-colors ${
              section() === "appearance"
                ? "bg-accent-soft text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
            onClick={() => setSection("appearance")}
          >
            {t("settings:appearance")}
          </button>
          <button
            type="button"
            data-testid="settings-section-shortcuts"
            data-active={section() === "shortcuts" ? "true" : "false"}
            aria-selected={section() === "shortcuts" ? "true" : "false"}
            class={`rounded-md px-3 py-1.5 text-left text-xs outline-none transition-colors ${
              section() === "shortcuts"
                ? "bg-accent-soft text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
            onClick={() => setSection("shortcuts")}
          >
            Shortcuts
          </button>
          <button
            type="button"
            data-testid="settings-section-desktop"
            data-active={section() === "desktop" ? "true" : "false"}
            aria-selected={section() === "desktop" ? "true" : "false"}
            class={`rounded-md px-3 py-1.5 text-left text-xs outline-none transition-colors ${
              section() === "desktop"
                ? "bg-accent-soft text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
            onClick={() => setSection("desktop")}
          >
            Desktop
          </button>
          <button
            type="button"
            data-testid="settings-section-notifications"
            data-active={section() === "notifications" ? "true" : "false"}
            aria-selected={section() === "notifications" ? "true" : "false"}
            class={`rounded-md px-3 py-1.5 text-left text-xs outline-none transition-colors ${
              section() === "notifications"
                ? "bg-accent-soft text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
            onClick={() => setSection("notifications")}
          >
            Notifications
          </button>
          <button
            type="button"
            data-testid="settings-section-updates"
            data-active={section() === "updates" ? "true" : "false"}
            aria-selected={section() === "updates" ? "true" : "false"}
            class={`rounded-md px-3 py-1.5 text-left text-xs outline-none transition-colors ${
              section() === "updates"
                ? "bg-accent-soft text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
            onClick={() => setSection("updates")}
          >
            Updates
          </button>
          <button
            type="button"
            data-testid="settings-section-language"
            data-active={section() === "language" ? "true" : "false"}
            aria-selected={section() === "language" ? "true" : "false"}
            class={`rounded-md px-3 py-1.5 text-left text-xs outline-none transition-colors ${
              section() === "language"
                ? "bg-accent-soft text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
            onClick={() => setSection("language")}
          >
            {t("settings:language")}
          </button>
          <span
            data-testid="settings-section-more"
            class="rounded-md px-3 py-1.5 text-xs text-fg-faint"
          >
            {t("settings:moreSections")}
          </span>
        </nav>
        <Show
          when={section() === "providers"}
          fallback={
            <Show
              when={section() === "appearance"}
              fallback={
                <Show
                  when={section() === "shortcuts"}
                  fallback={
                    <Show
                      when={section() === "desktop"}
                      fallback={
                        <Show
                          when={section() === "notifications"}
                          fallback={
                            <Show when={section() === "updates"} fallback={<LanguageSection />}>
                              <UpdatesSection />
                            </Show>
                          }
                        >
                          <NotificationsSection />
                        </Show>
                      }
                    >
                      <DesktopSection />
                    </Show>
                  }
                >
                  <ShortcutsSection />
                </Show>
              }
            >
              <AppearanceSection serverId={props.serverId} />
            </Show>
          }
        >
          <ProviderKeys serverId={props.serverId} />
        </Show>
      </div>
    </div>
  );
};

export default SettingsPage;
