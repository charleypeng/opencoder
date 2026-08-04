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

export interface SettingsPageProps {
  /** The server whose settings are shown. */
  serverId: string;
  /** Called by the header's Back button to leave the settings view. */
  onBack: () => void;
}

type SettingsSection = "providers" | "shortcuts";

const SettingsPage: Component<SettingsPageProps> = (props) => {
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
          ← Back
        </button>
        <h2 class="shrink-0 text-sm font-semibold">Settings</h2>
      </header>
      <div class="flex min-h-0 flex-1">
        <nav
          data-testid="settings-sections"
          class="flex w-40 shrink-0 flex-col gap-1 border-r border-bg-sunken p-2"
          aria-label="Settings sections"
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
          <span
            data-testid="settings-section-more"
            class="rounded-md px-3 py-1.5 text-xs text-fg-faint"
          >
            More sections — M9-04
          </span>
        </nav>
        <Show when={section() === "providers"} fallback={<ShortcutsSection />}>
          <ProviderKeys serverId={props.serverId} />
        </Show>
      </div>
    </div>
  );
};

export default SettingsPage;
