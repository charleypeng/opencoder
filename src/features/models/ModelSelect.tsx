// Compact model select (TASK-M6-06): two dropdowns (provider + model)
// over the models store catalog, restricted to connected providers, used
// by the summarize/init dialogs. The effective selection resolves the
// parent's value, else the session's own model when its provider is
// connected (via activeModelFor), falling back to the config default and
// then the first model of the first connected provider; the resolved ref
// is pushed up through onChange (on mount and whenever it becomes
// derivable, e.g. after the catalog fetch lands), so the parent's confirm
// enables without a user interaction.

import { createEffect, createMemo, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { createProviderService } from "../../services/provider.js";
import { getApiClient } from "../../services/client.js";
import type { Session } from "../../services/session.js";
import { useT } from "../../i18n/index.js";
import {
  activeModelFor,
  getServerModelState,
  type ModelRef,
  modelsOf,
  setConfigDefault,
  setProviders,
} from "../../stores/models.js";

export interface ModelSelectProps {
  /** The server whose model catalog is selected from. */
  serverId: string;
  /** The session whose model seeds the initial selection. */
  session: Session | undefined;
  /** Current selection; null lets the session default apply. */
  value: ModelRef | null;
  onChange: (ref: ModelRef) => void;
}

const selectClass =
  "min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-sunken px-2 py-1.5 " +
  "text-sm text-fg-primary outline-none focus:border-fg-faint";

export const ModelSelect: Component<ModelSelectProps> = (props) => {
  const t = useT();
  const state = createMemo(() => getServerModelState(props.serverId));
  const connectedProviders = createMemo(() =>
    state().providers.filter((p) => state().connected.includes(p.id)),
  );

  // Catalog fetch: the select is mounted while its dialog is open, so a
  // mount-time fetch fills the store when nothing has loaded it yet (the
  // picker/PromptBox use the same pattern). The per-instance guard fires
  // the fetch at most once (a later store change must not re-fetch).
  let fetchAttempted = false;
  createEffect(() => {
    if (fetchAttempted) return;
    fetchAttempted = true;
    if (state().loaded) return;
    const serverId = props.serverId;
    void Promise.allSettled([
      createProviderService(getApiClient()).list(),
      createProviderService(getApiClient()).configProviders(),
    ]).then(([list, config]) => {
      if (list.status === "fulfilled") setProviders(serverId, list.value);
      if (config.status === "fulfilled" && config.value?.default !== undefined) {
        setConfigDefault(serverId, config.value.default);
      }
    });
  });

  /** Effective ref: the parent's value, else the session's resolved model,
   *  else the first model of the first connected provider. */
  const effective = createMemo<ModelRef | null>(() => {
    if (props.value !== null) return props.value;
    const resolved = activeModelFor(props.serverId, props.session?.id ?? "", props.session?.model);
    if (resolved !== null) return resolved;
    const first = connectedProviders()[0];
    const firstModel = first === undefined ? undefined : modelsOf(first)[0];
    return first !== undefined && firstModel !== undefined
      ? { providerID: first.id, modelID: firstModel.id }
      : null;
  });

  // Push the resolved ref up so the parent's confirm enables as soon as a
  // selection is derivable (mount, or once the catalog fetch lands). A
  // user-driven change already carries the same ref through props.value,
  // so the push is a no-op there (identical reference).
  createEffect(() => {
    const ref = effective();
    if (ref !== null) props.onChange(ref);
  });

  const provider = createMemo(
    () => connectedProviders().find((p) => p.id === effective()?.providerID) ?? null,
  );
  const models = createMemo(() => (provider() === null ? [] : modelsOf(provider()!)));

  function changeProvider(id: string): void {
    const next = connectedProviders().find((p) => p.id === id);
    const first = next === undefined ? undefined : modelsOf(next)[0];
    if (first !== undefined) props.onChange({ providerID: id, modelID: first.id });
  }

  function changeModel(id: string): void {
    const pid = effective()?.providerID;
    if (pid !== undefined) props.onChange({ providerID: pid, modelID: id });
  }

  return (
    <Show
      when={connectedProviders().length > 0}
      fallback={
        <p data-testid="model-select-empty" class="text-xs text-fg-secondary">
          No connected providers — add an API key in Settings first.
        </p>
      }
    >
      <div class="flex items-center gap-2">
        <select
          data-testid="model-select-provider"
          aria-label={t("models:providerLabel")}
          class={selectClass}
          value={effective()?.providerID ?? ""}
          onChange={(event) => changeProvider(event.currentTarget.value)}
        >
          <For each={connectedProviders()}>
            {(entry) => <option value={entry.id}>{entry.name}</option>}
          </For>
        </select>
        <select
          data-testid="model-select-model"
          aria-label={t("models:modelLabel")}
          class={selectClass}
          value={effective()?.modelID ?? ""}
          onChange={(event) => changeModel(event.currentTarget.value)}
        >
          <For each={models()}>
            {(entry) => <option value={entry.id}>{entry.name ?? entry.id}</option>}
          </For>
        </select>
      </div>
    </Show>
  );
};

export default ModelSelect;
