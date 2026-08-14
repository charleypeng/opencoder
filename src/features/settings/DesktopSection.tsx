// Desktop settings section (TASK-M8-05): the close-to-tray switch and
// the global summon accelerator input. Changes are applied to Rust
// immediately (set_close_to_tray / set_global_shortcut) and persisted to
// localStorage (desktopPrefs) so the next launch re-applies them; the
// controls always mirror the APPLIED state (failures revert / surface
// inline instead of drifting). TASK-M8-07 adds the "Show pet" switch
// (desktopPrefs petEnabled, default on) that shows/hides the pet
// companion window and persists the choice, and the "Pet click-through"
// switch (pet_set_ignore_mouse / pet_get_ignore_mouse): the escape hatch
// for a click-through pet, which ignores every pointer event and is
// otherwise unreachable.

import { createEffect, createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import {
  getCloseToTray,
  getGlobalShortcut,
  setCloseToTray,
  setGlobalShortcut,
} from "../../services/tray.js";
import { getPetIgnoreMouse, setPetIgnoreMouse } from "../../services/pet.js";
import { loadDesktopPrefs, petEnabled, saveDesktopPrefs, setPetEnabled } from "./desktopPrefs.js";
import { useT } from "../../i18n/index.js";

const DesktopSection: Component = () => {
  const t = useT();
  const [closeToTray, setCloseToTrayState] = createSignal(false);
  const [toggleBusy, setToggleBusy] = createSignal(false);
  const [shortcutDraft, setShortcutDraft] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [showPet, setShowPet] = createSignal(petEnabled());
  const [petBusy, setPetBusy] = createSignal(false);
  const [petClickThrough, setPetClickThrough] = createSignal(false);
  const [petClickThroughBusy, setPetClickThroughBusy] = createSignal(false);

  // One-shot load of the current Rust values on mount.
  createEffect(() => {
    if (loaded()) return;
    setLoaded(true);
    void getCloseToTray()
      .then(setCloseToTrayState)
      .catch(() => setError(t("settings:closeToTrayReadError")));
    void getGlobalShortcut()
      .then(setShortcutDraft)
      .catch(() => setError(t("settings:summonReadError")));
    void getPetIgnoreMouse()
      .then(setPetClickThrough)
      .catch(() => setError(t("settings:clickThroughReadError")));
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

  /** Toggles the pet companion: the window action runs first (so the
   *  visible state never drifts from what actually happened), then the
   *  pref is persisted. */
  async function togglePet() {
    if (petBusy()) return;
    setPetBusy(true);
    setError(null);
    try {
      await setPetEnabled(!showPet());
      setShowPet((shown) => !shown);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPetBusy(false);
    }
  }

  /** Toggles pet click-through (the escape hatch: a click-through pet
   *  ignores every pointer event, so the main window must be able to
   *  re-enable clicks). The switch mirrors the applied state. */
  async function togglePetClickThrough() {
    if (petClickThroughBusy()) return;
    setPetClickThroughBusy(true);
    setError(null);
    try {
      await setPetIgnoreMouse(!petClickThrough());
      setPetClickThrough((through) => !through);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPetClickThroughBusy(false);
    }
  }

  return (
    <div data-testid="desktop-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("settings:desktop")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:desktopHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">{t("settings:showPet")}</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:showPetHint")}</p>
          </div>
          <button
            type="button"
            role="switch"
            data-testid="desktop-show-pet"
            aria-checked={showPet() ? "true" : "false"}
            aria-label={t("settings:showPet")}
            disabled={petBusy()}
            onClick={() => void togglePet()}
            class={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors disabled:opacity-50 ${
              showPet() ? "bg-accent" : "bg-bg-sunken"
            }`}
          >
            <span
              class={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-fg-primary transition-transform ${
                showPet() ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">{t("settings:petClickThrough")}</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:petClickThroughHint")}</p>
          </div>
          <button
            type="button"
            role="switch"
            data-testid="desktop-pet-click-through"
            aria-checked={petClickThrough() ? "true" : "false"}
            aria-label={t("settings:petClickThrough")}
            disabled={petClickThroughBusy()}
            onClick={() => void togglePetClickThrough()}
            class={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors disabled:opacity-50 ${
              petClickThrough() ? "bg-accent" : "bg-bg-sunken"
            }`}
          >
            <span
              class={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-fg-primary transition-transform ${
                petClickThrough() ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">{t("settings:closeToTray")}</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:closeToTrayHint")}</p>
          </div>
          <button
            type="button"
            role="switch"
            data-testid="desktop-close-to-tray"
            aria-checked={closeToTray() ? "true" : "false"}
            aria-label={t("settings:closeToTray")}
            disabled={toggleBusy()}
            onClick={() => void toggleCloseToTray()}
            class={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors disabled:opacity-50 ${
              closeToTray() ? "bg-accent" : "bg-bg-sunken"
            }`}
          >
            <span
              class={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-fg-primary transition-transform ${
                closeToTray() ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        <div class="py-3">
          <p class="text-xs font-medium">{t("settings:globalSummon")}</p>
          <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:summonHintFull")}</p>
          <div class="mt-2 flex items-center gap-2">
            <input
              data-testid="desktop-shortcut-input"
              type="text"
              value={shortcutDraft()}
              placeholder="Alt+Space"
              aria-label={t("settings:globalSummon")}
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
              {saving() ? t("common:saving") : t("common:save")}
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
