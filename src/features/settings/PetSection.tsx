// Pet settings section: controls the companion window visibility and its
// click-through escape hatch. Both settings apply immediately and persist
// through the existing desktop preference and pet service layers.

import { createEffect, createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { useT } from "../../i18n/index.js";
import { getPetIgnoreMouse, setPetIgnoreMouse } from "../../services/pet.js";
import { petEnabled, setPetEnabled } from "./desktopPrefs.js";

function ToggleSwitch(props: {
  testId: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      data-testid={props.testId}
      aria-checked={props.checked ? "true" : "false"}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onToggle(!props.checked)}
      class={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors disabled:opacity-50 ${
        props.checked ? "bg-accent" : "bg-bg-sunken"
      }`}
    >
      <span
        class={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-fg-primary transition-transform ${
          props.checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

const PetSection: Component<{ serverId: string }> = () => {
  const t = useT();
  const [showPet, setShowPet] = createSignal(petEnabled());
  const [petBusy, setPetBusy] = createSignal(false);
  const [petClickThrough, setPetClickThrough] = createSignal(false);
  const [petClickThroughBusy, setPetClickThroughBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);

  createEffect(() => {
    if (loaded()) return;
    setLoaded(true);
    void getPetIgnoreMouse()
      .then(setPetClickThrough)
      .catch(() => setError(t("settings:clickThroughReadError")));
  });

  async function togglePet(): Promise<void> {
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

  async function togglePetClickThrough(): Promise<void> {
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
    <div data-testid="pet-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("settings:pet")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:petHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="flex items-center justify-between gap-3 border-b border-bg-sunken py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">{t("settings:showPet")}</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:showPetHint")}</p>
          </div>
          <ToggleSwitch
            testId="pet-show"
            label={t("settings:showPet")}
            checked={showPet()}
            disabled={petBusy()}
            onToggle={() => void togglePet()}
          />
        </div>
        <div class="flex items-center justify-between gap-3 py-3">
          <div class="min-w-0">
            <p class="text-xs font-medium">{t("settings:petClickThrough")}</p>
            <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:petClickThroughHint")}</p>
          </div>
          <ToggleSwitch
            testId="pet-click-through"
            label={t("settings:petClickThrough")}
            checked={petClickThrough()}
            disabled={petClickThroughBusy()}
            onToggle={() => void togglePetClickThrough()}
          />
        </div>
      </div>
      <Show when={error() !== null}>
        <div
          data-testid="pet-error"
          role="alert"
          class="border-t border-danger/30 bg-danger/10 px-4 py-2"
        >
          <p class="text-xs text-danger">{error()}</p>
        </div>
      </Show>
    </div>
  );
};

export default PetSection;
