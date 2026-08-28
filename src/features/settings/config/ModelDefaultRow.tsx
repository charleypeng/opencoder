// Client-side default-model row (TASK-S1-01, folded into Config per
// docs/ui-audit-2026-08 §7 — the Models nav section was a single row that
// duplicated the Config editor): the per-server LOCAL default persisted in
// localStorage (`oc-default-model:{serverId}`, models store setLocalDefault)
// that slots into the model resolution chain ABOVE the server's config
// default and BELOW a session's explicit selection. The row shows the
// effective default (local choice ?? config default), a Change button
// opening the reused ModelPickerContent (onPick injection, so the choice
// targets the local default instead of a session) and a Clear button that
// resets to the server default. The catalog is NOT fetched here —
// ConfigSection pre-loads it on mount and ModelPickerContent re-fetches
// through the store's loaded flag when the dialog opens.

import { createMemo, createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { useT } from "../../../i18n/index.js";
import {
  getServerModelState,
  type ModelRef,
  setLocalDefault,
  usable,
} from "../../../stores/models.js";
import { modelName } from "../../models/models.js";
import { ModelPickerContent } from "../../models/ModelPicker.js";

export interface ModelDefaultRowProps {
  /** The server whose local default is edited here. */
  serverId: string;
}

const ModelDefaultRow: Component<ModelDefaultRowProps> = (props) => {
  const t = useT();
  const state = createMemo(() => getServerModelState(props.serverId));
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [cleared, setCleared] = createSignal(false);

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
    <div data-testid="model-default-row" class="border-b border-bg-sunken py-3">
      {/* Wrap-friendly row (ConfigSection.row parity): the value + Change
          group drops BELOW the label on narrow windows instead of being
          pinned into a fixed-width box where it clips. */}
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div class="min-w-0 max-w-full flex-1 basis-64">
          <p class="text-xs font-medium">{t("settings:modelsDefault")}</p>
          <p class="mt-0.5 text-xs text-fg-secondary">{t("settings:modelsDefaultHint")}</p>
        </div>
        <div class="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
          <Show
            when={resolved() !== null}
            fallback={<span class="text-xs text-fg-faint">{t("settings:configNotSet")}</span>}
          >
            <span
              data-testid="model-default-value"
              class="max-w-[12rem] truncate rounded-md border border-bg-sunken bg-bg-elevated px-2.5 py-1.5 font-mono text-xs text-fg-default"
            >
              {resolvedLabel()}
            </span>
            <Show when={resolved()?.local === true}>
              <span
                data-testid="model-local-chip"
                class="rounded border border-accent/40 px-1 py-px text-[10px] font-medium text-accent"
              >
                {t("models:localDefault")}
              </span>
            </Show>
            <Show when={resolved() !== null && resolved()?.local === false}>
              <span
                data-testid="model-server-chip"
                class="rounded border border-bg-sunken bg-bg-sunken px-1 py-px text-[10px] font-medium text-fg-secondary"
              >
                {t("models:default")}
              </span>
            </Show>
          </Show>
          <button
            type="button"
            data-testid="model-default-change"
            onClick={() => setPickerOpen(true)}
            class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none transition-colors hover:text-fg-primary"
          >
            {t("settings:modelsChange")}
          </button>
          <Show when={state().localDefault !== null}>
            <button
              type="button"
              data-testid="model-default-clear"
              onClick={clearDefault}
              class="rounded-md px-3 py-1.5 text-xs text-fg-secondary outline-none transition-colors hover:text-fg-primary"
            >
              {t("settings:modelsClear")}
            </button>
          </Show>
          <Show when={cleared()}>
            <span data-testid="model-cleared" class="text-xs text-fg-faint">
              {t("settings:modelsCleared")}
            </span>
          </Show>
        </div>
      </div>

      <Dialog.Root open={pickerOpen()} onOpenChange={setPickerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content
            data-testid="model-picker"
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

export default ModelDefaultRow;
