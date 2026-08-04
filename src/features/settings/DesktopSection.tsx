// Desktop settings section (TASK-M8-05): the close-to-tray switch and
// the global summon accelerator input. Changes are applied to Rust
// immediately (set_close_to_tray / set_global_shortcut) and persisted to
// localStorage (desktopPrefs) so the next launch re-applies them; the
// controls always mirror the APPLIED state (failures revert / surface
// inline instead of drifting).

import { createEffect, createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import {
  getCloseToTray,
  getGlobalShortcut,
  setCloseToTray,
  setGlobalShortcut,
} from "../../services/tray.js";
import { loadDesktopPrefs, saveDesktopPrefs } from "./desktopPrefs.js";

const DesktopSection: Component = () => {
  const [closeToTray, setCloseToTrayState] = createSignal(false);
  const [toggleBusy, setToggleBusy] = createSignal(false);
  const [shortcutDraft, setShortcutDraft] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);

  // One-shot load of the current Rust values on mount.
  createEffect(() => {
    if (loaded()) return;
    setLoaded(true);
    void getCloseToTray()
      .then(setCloseToTrayState)
      .catch(() => setError("Could not read the close-to-tray setting"));
    void getGlobalShortcut()
      .then(setShortcutDraft)
      .catch(() => setError("Could not read the global summon shortcut"));
  });

  /** Toggles close-to-tray; on success the switch flips and the pref is
   *  persisted, on failure the switch stays off with an inline error. */
  async function toggleCloseToTray() {
    const next = !closeToTray();
    if (toggleBusy()) return;
    setToggleBusy(true);
    setError(null);
    try {
      await setCloseToTray(next);
      setCloseToTrayState(next);
      saveDesktopPrefs({ ...loadDesktopPrefs(), closeToTray: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setToggleBusy(false);
    }
  }

  /** Saves a custom summon accelerator; the applied (Rust-validated)
   *  value replaces the draft and is persisted. */
  async function saveShortcut() {
    const value = shortcutDraft().trim();
    if (value === "" || saving()) return;
    setSaving(true);
    setError(null);
    try {
      const applied = await setGlobalShortcut(value);
      setShortcutDraft(applied);
      saveDesktopPrefs({ ...loadDesktopPrefs(), globalShortcut: applied });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="desktop-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">Desktop</h2>
        <p class="text-xs text-fg-secondary">System tray and global summon settings.</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">Close to tray</p>
            <p class="mt-0.5 text-xs text-fg-secondary">
              Closing the window hides it to the tray instead of quitting.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            data-testid="desktop-close-to-tray"
            aria-checked={closeToTray() ? "true" : "false"}
            aria-label="Close to tray"
            disabled={toggleBusy()}
            onClick={() => void toggleCloseToTray()}
            class={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors disabled:opacity-50 ${
              closeToTray() ? "bg-accent" : "bg-bg-sunken"
            }`}
          >
            <span
              class={`absolute top-0.5 h-5 w-5 rounded-full bg-fg-primary transition-transform ${
                closeToTray() ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        <div class="py-3">
          <p class="text-xs font-medium">Global summon shortcut</p>
          <p class="mt-0.5 text-xs text-fg-secondary">
            Brings the app to the front from anywhere (e.g. Alt+Space, Ctrl+Shift+O).
          </p>
          <div class="mt-2 flex items-center gap-2">
            <input
              data-testid="desktop-shortcut-input"
              type="text"
              value={shortcutDraft()}
              placeholder="Alt+Space"
              aria-label="Global summon shortcut"
              spellcheck={false}
              onInput={(event) => {
                setShortcutDraft(event.currentTarget.value);
                setError(null);
              }}
              class="min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-fg-faint focus:border-fg-faint"
            />
            <button
              type="button"
              data-testid="desktop-shortcut-save"
              disabled={saving() || shortcutDraft().trim() === ""}
              onClick={() => void saveShortcut()}
              class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving() ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
      <Show when={error() !== null}>
        <div
          data-testid="desktop-error"
          role="alert"
          class="shrink-0 border-t border-danger/30 bg-danger/10 px-4 py-2"
        >
          <p class="text-xs text-danger">{error()}</p>
        </div>
      </Show>
    </div>
  );
};

export default DesktopSection;
