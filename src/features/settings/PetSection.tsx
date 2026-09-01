// Pet settings section: controls the companion window visibility and its
// click-through escape hatch. Both settings apply immediately and persist
// through the existing desktop preference and pet service layers.

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import type { Component } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { useT } from "../../i18n/index.js";
import {
  notifyPetPrefsChanged,
  getPetIgnoreMouse,
  setPetIgnoreMouse,
  setPetOpacity,
  setPetSize,
} from "../../services/pet.js";
import { petEnabled, setPetEnabled } from "./desktopPrefs.js";
import { loadPetPrefs, savePetPrefs, type PetMovement } from "../pet/petPrefs.js";
import { petPacks, petPacksLoading, refreshPetPacks } from "../pet/packStore.js";
import { getPetPackAssetUrl, installPetPack, PetPackError } from "../../services/petPacks.js";
import type { PetPackSummary } from "../pet/packTypes.js";

function PetPackPreview(props: { pack: PetPackSummary }) {
  const [previewUrl] = createResource(
    () => `${props.pack.id}\u0000${props.pack.preview}`,
    async (assetKey) => {
      const separator = assetKey.indexOf("\u0000");
      const packId = separator === -1 ? assetKey : assetKey.slice(0, separator);
      const preview = separator === -1 ? "" : assetKey.slice(separator + 1);
      try {
        return await getPetPackAssetUrl(packId, preview);
      } catch {
        return null;
      }
    },
  );

  return (
    <div
      data-testid={`pet-pack-preview-${props.pack.id}`}
      class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-sunken/70"
    >
      <Show
        when={previewUrl()}
        fallback={
          <svg viewBox="0 0 64 64" class="h-10 w-10 text-fg-faint" aria-hidden="true">
            <path d="M12 28 20 16h24l8 12v20H12Z" fill="currentColor" opacity=".24" />
            <circle cx="25" cy="34" r="3" fill="currentColor" />
            <circle cx="39" cy="34" r="3" fill="currentColor" />
            <path d="M25 43c4 3 10 3 14 0" fill="none" stroke="currentColor" stroke-width="3" />
          </svg>
        }
      >
        <img
          src={previewUrl() ?? undefined}
          alt=""
          class="h-full w-full object-contain"
          draggable={false}
        />
      </Show>
    </div>
  );
}

function PetPackCard(props: {
  pack: PetPackSummary;
  selected: boolean;
  onSelect: () => void;
  builtInLabel: string;
  localLabel: string;
  authorLabel: string;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.selected}
      data-testid={`pet-pack-${props.pack.id}`}
      onClick={() => props.onSelect()}
      class={`group flex min-w-0 items-center gap-3 rounded-lg border p-2.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60 ${
        props.selected
          ? "border-accent bg-accent-soft"
          : "border-bg-sunken bg-bg-sunken/40 hover:border-fg-faint hover:bg-bg-hover"
      }`}
    >
      <PetPackPreview pack={props.pack} />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-fg-primary">{props.pack.name}</span>
        <span class="mt-0.5 block truncate font-code text-[11px] text-fg-secondary">
          {props.pack.id}
        </span>
        <span class="mt-1 block truncate text-[11px] text-fg-faint">
          {props.pack.source === "bundled" ? props.builtInLabel : props.localLabel}
          {props.pack.author ? ` · ${props.authorLabel}` : ""}
        </span>
      </span>
      <Show when={props.selected}>
        <span class="shrink-0 text-accent" aria-hidden="true">
          ✓
        </span>
      </Show>
    </button>
  );
}

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
  const [selectedPackId, setSelectedPackId] = createSignal(loadPetPrefs().selectedPackId);
  const [packQuery, setPackQuery] = createSignal("");
  const [movement, setMovement] = createSignal<PetMovement>(loadPetPrefs().movement ?? "fixed");
  const [size, setSize] = createSignal(loadPetPrefs().size ?? 160);
  const [opacity, setOpacity] = createSignal(loadPetPrefs().opacity ?? 1);
  const [error, setError] = createSignal<string | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const filteredPacks = createMemo(() => {
    const query = packQuery().trim().toLowerCase();
    if (!query) return petPacks();
    return petPacks().filter((pack) =>
      [pack.name, pack.id, pack.author ?? "", pack.description ?? ""].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  });

  createEffect(() => {
    if (loaded()) return;
    setLoaded(true);
    void getPetIgnoreMouse()
      .then(setPetClickThrough)
      .catch(() => setError(t("settings:clickThroughReadError")));
  });

  onMount(() => {
    void refreshPetPacks().catch(() => setError(t("pet:packLoadError")));
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
      const next = !petClickThrough();
      setPetClickThrough(next);
      persistPrefs({ clickThrough: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPetClickThroughBusy(false);
    }
  }

  function persistPrefs(patch: Parameters<typeof savePetPrefs>[0]): void {
    savePetPrefs({ ...loadPetPrefs(), ...patch });
    void notifyPetPrefsChanged(patch);
  }

  function selectPack(id: string): void {
    setSelectedPackId(id);
    persistPrefs({ selectedPackId: id });
  }

  async function importPack(): Promise<void> {
    if (importing()) return;
    setImporting(true);
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "OpenCoder pet pack", extensions: ["opet"] }],
      });
      if (typeof selected !== "string") return;
      const result = await installPetPack(selected);
      await refreshPetPacks();
      selectPack(result.pack.id);
    } catch (err) {
      if (err instanceof PetPackError && err.code === "reservedPackId") {
        setError(t("pet:bundledPackAlreadyInstalled"));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setImporting(false);
    }
  }

  function changeMovement(value: PetMovement): void {
    setMovement(value);
    persistPrefs({ movement: value });
  }

  function changeSize(value: number): void {
    setSize(value);
    void setPetSize(value);
    persistPrefs({ size: value });
  }

  function changeOpacity(value: number): void {
    setOpacity(value);
    void setPetOpacity(value);
    persistPrefs({ opacity: value });
  }

  return (
    <div data-testid="pet-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("settings:pet")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:petHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Label-left / control-right rows (docs feedback): the stacked
            full-width selects and sliders read as a loose form; the rows
            mirror the toggle rows below them. Controls stay inside their
            <label> so the association survives the layout change. */}
        <div class="space-y-1 border-b border-bg-sunken pb-2">
          <section aria-label={t("pet:availablePacks")} class="py-2">
            <div class="mb-2 flex items-center justify-between gap-3">
              <p class="text-xs font-medium">{t("pet:availablePacks")}</p>
              <button
                type="button"
                data-testid="pet-pack-import"
                disabled={importing()}
                onClick={() => void importPack()}
                class="rounded-md border border-bg-sunken px-2 py-1 text-xs font-medium hover:bg-bg-hover disabled:opacity-50"
              >
                {importing() ? t("pet:importingPack") : t("pet:importPack")}
              </button>
            </div>
            <input
              data-testid="pet-pack-search"
              type="search"
              value={packQuery()}
              placeholder={t("pet:searchPacks")}
              aria-label={t("pet:searchPacks")}
              onInput={(event) => setPackQuery(event.currentTarget.value)}
              class="mb-3 w-full rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 text-sm outline-none placeholder:text-fg-faint focus:border-accent"
            />
            <div
              role="listbox"
              aria-label={t("pet:availablePacks")}
              class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="pet-pack-list"
            >
              <For each={filteredPacks()}>
                {(pack) => (
                  <PetPackCard
                    pack={pack}
                    selected={selectedPackId() === pack.id}
                    onSelect={() => selectPack(pack.id)}
                    builtInLabel={t("pet:bundledPack")}
                    localLabel={t("pet:localPack")}
                    authorLabel={t("pet:packAuthor", { author: pack.author })}
                  />
                )}
              </For>
              <Show when={!petPacksLoading() && petPacks().length === 0}>
                <p class="col-span-full rounded-md border border-dashed border-bg-sunken px-2.5 py-4 text-xs text-fg-secondary">
                  {t("pet:noPacks")}
                </p>
              </Show>
              <Show
                when={!petPacksLoading() && petPacks().length > 0 && filteredPacks().length === 0}
              >
                <p
                  data-testid="pet-pack-empty"
                  class="col-span-full rounded-md border border-dashed border-bg-sunken px-2.5 py-4 text-xs text-fg-secondary"
                >
                  {t("pet:noMatchingPacks")}
                </p>
              </Show>
            </div>
          </section>
          <label class="flex items-center justify-between gap-3 py-2 text-xs font-medium">
            <span class="min-w-0">{t("pet:movement")}</span>
            <select
              data-testid="pet-movement-select"
              value={movement()}
              onChange={(event) => changeMovement(event.currentTarget.value as PetMovement)}
              class="w-44 shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs"
            >
              <option value="fixed">{t("pet:movementFixed")}</option>
              <option value="roam">{t("pet:movementRoam")}</option>
              <option value="bottom">{t("pet:movementBottom")}</option>
            </select>
          </label>
          <label class="flex items-center justify-between gap-3 py-2 text-xs font-medium">
            <span class="min-w-0 shrink-0">
              {t("pet:petSize")} · {size()}px
            </span>
            <input
              data-testid="pet-size-slider"
              type="range"
              min="120"
              max="200"
              step="10"
              value={size()}
              onInput={(event) => changeSize(Number(event.currentTarget.value))}
              class="w-44 shrink-0 cursor-pointer accent-accent"
            />
          </label>
          <label class="flex items-center justify-between gap-3 py-2 text-xs font-medium">
            <span class="min-w-0 shrink-0">
              {t("pet:petOpacity")} · {Math.round(opacity() * 100)}%
            </span>
            <input
              data-testid="pet-opacity-slider"
              type="range"
              min="0.4"
              max="1"
              step="0.05"
              value={opacity()}
              onInput={(event) => changeOpacity(Number(event.currentTarget.value))}
              class="w-44 shrink-0 cursor-pointer accent-accent"
            />
          </label>
        </div>
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
