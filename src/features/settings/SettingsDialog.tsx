// Settings dialog (TASK-UI-01): the settings center presented as a modal
// overlay on every platform instead of a routed page — a dimmed backdrop
// (click to close), an Esc-to-close portal and the shared SettingsPage
// (desktop: centered panel with sidebar nav; mobile: full-bleed sheet
// with chip nav). The page's own header carries the close button on
// desktop; the mobile sheet gets its own close header because the mobile
// page variant has none.
//
// The dialog is mounted by DesktopShell (gear button / command palette /
// shortcut) and by MobileShell (settings tab / native bar), so settings
// floats above whatever view is active instead of replacing it.

import { onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { useT } from "../../i18n/index.js";
import SettingsPage from "./SettingsPage.js";

export interface SettingsDialogProps {
  /** The server whose settings are shown. */
  serverId: string;
  /** Mobile presentation: full-bleed sheet instead of a centered panel. */
  mobile?: boolean;
  /** Called when the dialog closes (close button, backdrop, Esc). */
  onClose: () => void;
}

const SettingsDialog: Component<SettingsDialogProps> = (props) => {
  const t = useT();
  // Esc closes the dialog; the backdrop click and the page's close button
  // use onClose directly. The listener is window-scoped so it works while
  // focus is anywhere inside the overlay.
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") props.onClose();
  }
  onMount(() => window.addEventListener("keydown", onKeyDown));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  return (
    <div
      data-testid="settings-dialog"
      data-variant={props.mobile === true ? "mobile" : "desktop"}
      class="fixed inset-0 z-50 flex items-center justify-center"
    >
      <button
        type="button"
        data-testid="settings-dialog-backdrop"
        aria-label={t("common:close")}
        class="absolute inset-0 h-full w-full cursor-default bg-black/50 outline-none"
        onClick={() => props.onClose()}
      />
      <div
        class={
          props.mobile === true
            ? "relative flex h-full w-full flex-col bg-bg-base"
            : "relative flex h-[min(640px,85vh)] w-[min(880px,92vw)] flex-col overflow-hidden rounded-xl border border-bg-sunken bg-bg-base shadow-xl"
        }
      >
        {/* The mobile page variant has no header, so the sheet provides
            the close affordance itself; desktop renders inside the page's
            own header. */}
        <Show when={props.mobile === true}>
          <header class="flex shrink-0 items-center justify-between border-b border-bg-sunken px-4 py-2">
            <h2 class="shrink-0 text-sm font-semibold">{t("settings:settings")}</h2>
            <button
              type="button"
              data-testid="settings-dialog-close"
              aria-label={t("common:close")}
              title={t("common:close")}
              class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1 text-xs leading-none text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
              onClick={() => props.onClose()}
            >
              ✕
            </button>
          </header>
        </Show>
        <div
          class={
            props.mobile === true ? "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1 flex-col"
          }
        >
          <SettingsPage
            serverId={props.serverId}
            onClose={props.onClose}
            variant={props.mobile === true ? "mobile" : "desktop"}
          />
        </div>
      </div>
    </div>
  );
};

export default SettingsDialog;
