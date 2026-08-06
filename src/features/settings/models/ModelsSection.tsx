// Models settings section (TASK-S1-01): the client-side global default
// model for the server — a choice persisted per server in localStorage
// (`oc-default-model:{serverId}`, models store setLocalDefault) that slots
// into the model resolution chain ABOVE the server's config default and
// BELOW a session's explicit selection. The section shows the current
// effective default (local choice ?? config default), a Change button
// opening the reused ModelPickerContent (onPick injection, so the choice
// targets the local default instead of a session), and a Clear button
// that resets to the server default. The catalog fetch mirrors the
// ModelPicker/ModelSelect pattern: one-shot on mount, in-flight guarded,
// with a retry from the empty state when it fails.

import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { createProviderService } from "../../../services/provider.js";
import { getApiClient } from "../../../services/client.js";
import { useT } from "../../../i18n/index.js";
import {
  getServerModelState,
  type ModelRef,
  setConfigDefault,
  setLocalDefault,
  setProviders,
  usable,
} from "../../../stores/models.js";
import { modelName } from "../../models/models.js";
import { ModelPickerContent } from "../../models/ModelPicker.js";

export interface ModelsSectionProps {
  /** The server whose default model is edited here. */
  serverId: string;
}

const ModelsSection: Component<ModelsSectionProps> = (props) => {
  const t = useT();
  const state = createMemo(() => getServerModelState(props.serverId));
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [loadFailed, setLoadFailed] = createSignal(false);
  const [cleared, setCleared] = createSignal(false);

  // Catalog fetch: one-shot per mount (ModelSelect pattern); a failed
  // fetch leaves loaded=false so the empty state offers a retry.
  let attempted = false;
  let inflight = false;

  function fetchCatalog(): void {
    const serverId = props.serverId;
    if (inflight) return;
    inflight = true;
    setLoadFailed(false);
    void Promise.allSettled([
      createProviderService(getApiClient()).list(),
      createProviderService(getApiClient()).configProviders(),
    ])
      .then(([list, config]) => {
        if (list.status === "rejected") setLoadFailed(true);
        if (list.status === "fulfilled") setProviders(serverId, list.value);
        if (config.status === "fulfilled" && config.value?.default !== undefined) {
          setConfigDefault(serverId, config.value.default);
        }
      })
      .finally(() => {
        inflight = false;
      });
  }

  createEffect(() => {
    if (state().loaded || attempted) return;
    attempted = true;
    fetchCatalog();
  });

  /** The effective default: the local choice when set AND still usable
   *  (provider connected + model in the catalog — the same gate the
   *  resolution chain applies, so the display never shows a default that
   *  sessions cannot resolve to), else the server's config default. */
  const resolved = createMemo<{ ref: ModelRef; local: boolean } | null>(() => {
    const current = state();
    const local = current.localDefault;
    if (local !== null && usable(current, local)) return { ref: local, local: true };
    const config = current.defaultModel;
    if (config !== null) return { ref: config, local: false };
    return null;
  });

  /** "Provider · Model" label for the effective default; falls back to
   *  the raw model id when the catalog does not carry the model. */
  const resolvedLabel = createMemo<string | null>(() => {
    const current = resolved();
    if (current === null) return null;
    const provider = state().providers.find((p) => p.id === current.ref.providerID);
    if (provider === undefined) return current.ref.modelID;
    const model = provider.models[current.ref.modelID];
    return `${provider.name} · ${model !== undefined ? modelName(model) : current.ref.modelID}`;
  });

  function pick(ref: ModelRef): void {
    setCleared(false);
    setLocalDefault(props.serverId, ref);
    setPickerOpen(false);
  }

  function clearDefault(): void {
    setLocalDefault(props.serverId, null);
    setCleared(true);
  }

  return (
    <div data-testid="models-section" class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-bg-sunken px-4 py-3">
        <h2 class="text-sm font-semibold">{t("settings:models")}</h2>
        <p class="text-xs text-fg-secondary">{t("settings:modelsHint")}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div data-testid="models-default-row" class="border-b border-bg-sunken py-3">
          <p class="text-xs font-medium">{t("settings:modelsDefault")}</p>
          <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:modelsDefaultHint")}</p>
          <Show
            when={state().loaded}
            fallback={
              <div
                data-testid="models-empty"
                class="mt-2 flex items-center gap-2 text-xs text-fg-secondary"
              >
                <span>
                  {loadFailed() ? t("settings:modelsLoadFailed") : t("settings:modelsLoading")}
                </span>
                <Show when={loadFailed()}>
                  <button
                    type="button"
                    data-testid="models-retry"
                    onClick={fetchCatalog}
                    class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none transition-colors hover:text-fg-primary"
                  >
                    {t("settings:configRetry")}
                  </button>
                </Show>
              </div>
            }
          >
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <Show
                when={resolved() !== null}
                fallback={<span class="text-xs text-fg-faint">{t("settings:configNotSet")}</span>}
              >
                <span
                  data-testid="models-default-value"
                  class="rounded-md border border-bg-sunken bg-bg-elevated px-2.5 py-1.5 font-mono text-xs text-fg-default"
                >
                  {resolvedLabel()}
                </span>
                <Show when={resolved()?.local === true}>
                  <span
                    data-testid="models-local-chip"
                    class="rounded border border-accent/40 px-1 py-px text-[10px] font-medium text-accent"
                  >
                    {t("models:localDefault")}
                  </span>
                </Show>
                <Show when={resolved() !== null && resolved()?.local === false}>
                  <span
                    data-testid="models-server-chip"
                    class="rounded border border-bg-sunken bg-bg-sunken px-1 py-px text-[10px] font-medium text-fg-secondary"
                  >
                    {t("models:default")}
                  </span>
                </Show>
              </Show>
              <button
                type="button"
                data-testid="models-default-change"
                onClick={() => setPickerOpen(true)}
                class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none transition-colors hover:text-fg-primary"
              >
                {t("settings:modelsChange")}
              </button>
              <Show when={state().localDefault !== null}>
                <button
                  type="button"
                  data-testid="models-default-clear"
                  onClick={clearDefault}
                  class="rounded-md px-3 py-1.5 text-xs text-fg-secondary outline-none transition-colors hover:text-fg-primary"
                >
                  {t("settings:modelsClear")}
                </button>
              </Show>
              <Show when={cleared()}>
                <span data-testid="models-cleared" class="text-xs text-fg-faint">
                  {t("settings:modelsCleared")}
                </span>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <Dialog.Root open={pickerOpen()} onOpenChange={setPickerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content
            data-testid="models-picker"
            class="glass fixed left-1/2 top-1/2 z-50 flex max-h-[75vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col p-5"
          >
            <Dialog.Title class="text-md font-semibold">{t("settings:modelsDefault")}</Dialog.Title>
            <Dialog.Description class="mt-1 text-sm text-fg-secondary">
              {t("settings:modelsDefaultHint")}
            </Dialog.Description>
            <div class="mt-4 flex min-h-0 flex-1 flex-col">
              <ModelPickerContent
                serverId={props.serverId}
                sessionId=""
                onClose={() => setPickerOpen(false)}
                onPick={pick}
                activeRef={state().localDefault}
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};

export default ModelsSection;
