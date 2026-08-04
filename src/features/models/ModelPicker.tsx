// Model picker (TASK-M5-05): lists the server's models grouped by
// provider with a search box, capability badges (tools/vision/reasoning),
// cost + context-limit hints, unconnected providers grayed out and
// disabled, a Default marker per provider (from the /config/providers
// default record) and a favorites section (star toggle persisted in
// localStorage `oc-fav-models`). The catalog is fetched on open through
// the models store (loaded flag + in-flight guard; PromptBox also
// pre-fetches on mount); selecting a model records the per-session choice
// in the store and closes the picker. Presentation (TASK-M7-05): the
// desktop keeps the kobalte Dialog; on mobile platforms (src/platform)
// the same content renders inside the Sheet bottom sheet — the picker is
// dismissible there (scrim / Esc / drag-down), unlike the permission and
// question sheets.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import Sheet from "../../components/Sheet.js";
import { platform } from "../../platform/index.js";
import { createProviderService, type Model, type Provider } from "../../services/provider.js";
import { getApiClient } from "../../services/client.js";
import { getServerSessionState } from "../../stores/session.js";
import { registerSheet } from "../../stores/sheets.js";
import {
  activeModelFor,
  getServerModelState,
  type ModelRef,
  setConfigDefault,
  setModelForSession,
  setProviders,
} from "../../stores/models.js";
import {
  capabilityBadges,
  formatContextLimit,
  formatCost,
  isFavorite,
  loadFavorites,
  modelName,
  modelRefKey,
  saveFavorites,
  toggleFavorite,
} from "./models.js";

export interface ModelPickerProps {
  /** The server whose model catalog is picked from. */
  serverId: string;
  /** The session the chosen model is recorded for. */
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function StarIcon(props: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill={props.filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`h-3.5 w-3.5 ${props.filled ? "text-accent" : "text-fg-faint"}`}
    >
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-3.5 w-3.5 shrink-0 text-accent"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

interface ModelRowProps {
  serverId: string;
  provider: Provider;
  model: Model;
  active: ModelRef | null;
  favorites: readonly string[];
  onSelect: (providerID: string, modelID: string) => void;
  onToggleFav: (providerID: string, modelID: string) => void;
}

function ModelRow(props: ModelRowProps) {
  const state = createMemo(() => getServerModelState(props.serverId));
  const connected = createMemo(() => state().connected.includes(props.provider.id));
  const defaultRow = createMemo(() => state().defaultModels[props.provider.id] === props.model.id);
  const activeRow = createMemo(
    () =>
      props.active?.providerID === props.provider.id && props.active?.modelID === props.model.id,
  );
  const fav = createMemo(() =>
    isFavorite(props.favorites, modelRefKey(props.provider.id, props.model.id)),
  );

  return (
    <div
      data-testid="model-item"
      data-provider={props.provider.id}
      data-model={props.model.id}
      data-connected={connected()}
      class={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs ${
        connected() ? "hover:bg-bg-sunken" : "cursor-not-allowed opacity-40"
      } ${activeRow() ? "bg-bg-sunken" : ""}`}
    >
      <button
        type="button"
        data-testid="model-fav"
        aria-label={
          fav() ? `Unfavorite ${modelName(props.model)}` : `Favorite ${modelName(props.model)}`
        }
        aria-pressed={fav()}
        onClick={(event) => {
          event.stopPropagation();
          props.onToggleFav(props.provider.id, props.model.id);
        }}
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-faint transition-colors hover:text-accent"
      >
        <StarIcon filled={fav()} />
      </button>
      <button
        type="button"
        data-testid="model-item-select"
        disabled={!connected()}
        onClick={() => props.onSelect(props.provider.id, props.model.id)}
        class="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left disabled:cursor-not-allowed"
      >
        <span class="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span class="flex w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span class="shrink-0 font-mono text-fg-default">{modelName(props.model)}</span>
            <Show when={defaultRow()}>
              <span
                data-testid="model-default"
                class="shrink-0 rounded border border-accent/40 px-1 py-px text-[10px] font-medium text-accent"
              >
                Default
              </span>
            </Show>
            <Show when={activeRow()}>
              <span data-testid="model-active" class="flex items-center gap-1 text-fg-faint">
                <CheckIcon />
                Current
              </span>
            </Show>
          </span>
          <span class="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-fg-faint">
            <span class="flex items-center gap-1">
              <For each={capabilityBadges(props.model)}>
                {(badge) => (
                  <span
                    data-testid="model-badge"
                    data-badge={badge}
                    class="rounded border border-bg-sunken bg-bg-elevated px-1 py-px text-[10px] uppercase tracking-wide text-fg-secondary"
                  >
                    {badge}
                  </span>
                )}
              </For>
            </span>
            <Show when={formatCost(props.model) !== null}>
              <span data-testid="model-cost">{formatCost(props.model)}</span>
            </Show>
            <Show when={formatContextLimit(props.model) !== null}>
              <span data-testid="model-context">{formatContextLimit(props.model)}</span>
            </Show>
          </span>
        </span>
      </button>
    </div>
  );
}

interface ModelPickerContentProps {
  serverId: string;
  sessionId: string;
  onClose: () => void;
}

/** The picker body — the search box, the grouped model list and the Close
 *  button — shared by the desktop dialog and the mobile bottom sheet. */
function ModelPickerContent(props: ModelPickerContentProps) {
  const [search, setSearch] = createSignal("");
  const [favorites, setFavorites] = createSignal<string[]>(loadFavorites());

  const sessionModel = createMemo(
    () => getServerSessionState(props.serverId).sessions[props.sessionId]?.model,
  );
  const active = createMemo(() => activeModelFor(props.serverId, props.sessionId, sessionModel()));

  /** Whether the model row matches the search (provider or model name). */
  function rowMatches(provider: Provider, model: Model, needle: string): boolean {
    if (needle === "") return true;
    if (provider.name.toLowerCase().includes(needle)) return true;
    return `${modelName(model)} ${model.id}`.toLowerCase().includes(needle);
  }

  interface Group {
    provider: Provider;
    models: Model[];
  }

  const groups = createMemo<Group[]>(() => {
    const needle = search().trim().toLowerCase();
    const state = getServerModelState(props.serverId);
    return state.providers
      .map((provider) => ({
        provider,
        models: Object.values(provider.models ?? {}).filter((model) =>
          rowMatches(provider, model, needle),
        ),
      }))
      .filter((group) => group.models.length > 0);
  });

  const favoriteRows = createMemo<{ provider: Provider; model: Model }[]>(() => {
    const favs = favorites();
    if (favs.length === 0) return [];
    return groups().flatMap((group) =>
      group.models
        .filter((model) => favs.includes(modelRefKey(group.provider.id, model.id)))
        .map((model) => ({ provider: group.provider, model })),
    );
  });

  function toggleFav(providerID: string, modelID: string): void {
    const key = modelRefKey(providerID, modelID);
    const next = toggleFavorite(favorites(), key);
    setFavorites(next);
    saveFavorites(next);
  }

  function selectModel(providerID: string, modelID: string): void {
    setModelForSession(props.serverId, props.sessionId, { providerID, modelID });
    props.onClose();
  }

  return (
    <>
      <input
        data-testid="model-picker-search"
        type="text"
        value={search()}
        placeholder="Search models…"
        aria-label="Search models"
        onInput={(event) => setSearch(event.currentTarget.value)}
        class="w-full rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-sm outline-none placeholder:text-fg-faint focus:border-fg-faint"
      />

      <div class="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <Show
          when={groups().length > 0}
          fallback={
            <div
              data-testid="model-picker-empty"
              class="px-1 py-3 text-center text-xs text-fg-faint"
            >
              {getServerModelState(props.serverId).loaded
                ? "No matching models"
                : "Models unavailable"}
            </div>
          }
        >
          <Show when={favoriteRows().length > 0}>
            <div data-testid="model-favorites-section">
              <h3 class="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
                Favorites
              </h3>
              <For each={favoriteRows()}>
                {({ provider, model }) => (
                  <ModelRow
                    serverId={props.serverId}
                    provider={provider}
                    model={model}
                    active={active()}
                    favorites={favorites()}
                    onSelect={selectModel}
                    onToggleFav={toggleFav}
                  />
                )}
              </For>
            </div>
          </Show>
          <For each={groups()}>
            {(group) => (
              <section data-testid="model-group" data-provider={group.provider.id}>
                <h3
                  data-testid="model-provider-header"
                  class="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint"
                >
                  <span class="truncate">{group.provider.name}</span>
                  <Show
                    when={
                      !getServerModelState(props.serverId).connected.includes(group.provider.id)
                    }
                  >
                    <span
                      data-testid="model-not-connected"
                      class="rounded border border-bg-sunken bg-bg-elevated px-1 py-px text-[10px] normal-case tracking-normal text-fg-secondary"
                    >
                      Not connected
                    </span>
                  </Show>
                </h3>
                <For each={group.models}>
                  {(model) => (
                    <ModelRow
                      serverId={props.serverId}
                      provider={group.provider}
                      model={model}
                      active={active()}
                      favorites={favorites()}
                      onSelect={selectModel}
                      onToggleFav={toggleFav}
                    />
                  )}
                </For>
              </section>
            )}
          </For>
        </Show>
      </div>

      <div class="flex justify-end pt-4">
        <button
          type="button"
          data-testid="model-picker-close"
          class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary hover:text-fg-primary"
          onClick={() => props.onClose()}
        >
          Close
        </button>
      </div>
    </>
  );
}

const ModelPicker: Component<ModelPickerProps> = (props) => {
  // Catalog fetch: in-flight guarded; reused across opens via the store's
  // loaded flag (PromptBox also pre-fetches on mount). A failed fetch
  // keeps loaded=false so the next open retries.
  let modelFetch: Promise<void> | null = null;

  createEffect(() => {
    if (!props.open) return;
    const serverId = props.serverId;
    if (getServerModelState(serverId).loaded || modelFetch !== null) return;
    modelFetch = Promise.allSettled([
      createProviderService(getApiClient()).list(),
      createProviderService(getApiClient()).configProviders(),
    ])
      .then(([list, config]) => {
        // The catalog and the config defaults settle independently: a
        // config failure must not discard a successful provider catalog
        // (M5 review) — the /provider default record covers the gap.
        if (list.status === "fulfilled") setProviders(serverId, list.value);
        if (config.status === "fulfilled" && config.value?.default !== undefined) {
          setConfigDefault(serverId, config.value.default);
        }
      })
      .finally(() => {
        modelFetch = null;
      });
  });

  onCleanup(() => {
    // A close mid-fetch must not let the guard leak into the next open.
    modelFetch = null;
  });

  const close = () => props.onOpenChange(false);
  // Mobile platforms present the picker as a bottom sheet (TASK-M7-05);
  // the desktop keeps the kobalte dialog. The picker is dismissible in
  // both — picking a model is a choice, not a forced answer. (The platform
  // never changes at runtime, so the two branches are exclusive.)
  const mobile = platform.kind === "mobile";

  // TASK-M7-10: register the sheet so Android's system back closes the
  // picker FIRST (dismissible — unlike the pinned permission/question
  // sheets, a picker choice is not a forced answer).
  createEffect(() => {
    registerSheet(
      "model-picker",
      mobile && props.open ? { id: "model-picker", dismissible: true, close } : null,
    );
    onCleanup(() => registerSheet("model-picker", null));
  });

  return (
    <>
      <Show when={mobile}>
        <Sheet
          open={props.open}
          onClose={close}
          snap="high"
          title="Select model"
          testId="model-picker"
          dismissible
        >
          <ModelPickerContent
            serverId={props.serverId}
            sessionId={props.sessionId}
            onClose={close}
          />
        </Sheet>
      </Show>
      <Show when={!mobile}>
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
          <Dialog.Portal>
            <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
            <Dialog.Content
              data-testid="model-picker"
              class="glass fixed left-1/2 top-1/2 z-50 flex max-h-[75vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col p-5"
            >
              <Dialog.Title class="text-md font-semibold">Select model</Dialog.Title>
              <Dialog.Description class="mt-1 text-sm text-fg-secondary">
                The choice is kept for this session.
              </Dialog.Description>
              <div class="mt-4 flex min-h-0 flex-1 flex-col">
                <ModelPickerContent
                  serverId={props.serverId}
                  sessionId={props.sessionId}
                  onClose={close}
                />
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </Show>
    </>
  );
};

export default ModelPicker;
