// Provider add dialog (TASK-S1-02): the "Add provider" entry of the
// Providers settings section. Dynamic providers are registered by merging
// `provider.<id>` (including the SDK package and model definition required by
// OpenCode) into
// the global or the project config via the Config PATCH family — the
// contract has no providers registry key, and the project-level PATCH
// targets the active server's current project directory through the
// client's global directory injection. Submit PATCHes, then re-lists the
// provider catalog (GET /provider -> models store) so the new provider
// appears in the Providers list and the Models section, toasts success and
// closes; failures stay inline with the dialog open. The id must be a slug
// (letters/digits/dashes/underscores); an apiKey without a baseURL is allowed
// and targets the provider's built-in endpoint (hint only).

import { createMemo, createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { createToast } from "../../../stores/toasts.js";
import { useT } from "../../../i18n/index.js";
import { getApiClient } from "../../../services/client.js";
import { createConfigService, type ConfigPatch } from "../../../services/config.js";
import { createProviderService } from "../../../services/provider.js";
import { setProviders } from "../../../stores/models.js";
import { buildProviderPatch, isValidProviderId } from "./addProvider.js";

export type AddProviderScope = "global" | "project";

export interface AddProviderDialogProps {
  /** The server whose provider catalog must be refreshed after the add. */
  serverId: string;
  /** Closes the dialog (cancel, Esc, backdrop). */
  onClose: () => void;
  /** Notifies the parent after the provider has been added and re-listed. */
  onAdded?: (providerID: string) => void;
}

const AddProviderDialog: Component<AddProviderDialogProps> = (props) => {
  const t = useT();
  const config = createConfigService(getApiClient());
  const providers = createProviderService(getApiClient());
  const [id, setId] = createSignal("");
  const [name, setName] = createSignal("");
  const [npm, setNpm] = createSignal("@ai-sdk/openai-compatible");
  const [baseURL, setBaseURL] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [modelID, setModelID] = createSignal("");
  const [modelName, setModelName] = createSignal("");
  const [scope, setScope] = createSignal<AddProviderScope>("global");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Validation hints appear only after the field was typed into — showing
  // "required" on a pristine dialog is premature (docs/ui-audit-2026-08 V8).
  const [idTouched, setIdTouched] = createSignal(false);
  const [modelTouched, setModelTouched] = createSignal(false);

  const trimmedId = () => id().trim();
  const trimmedModelID = () => modelID().trim();
  // Empty id: the required hint; non-empty invalid id: the slug hint.
  const idValid = createMemo(() => isValidProviderId(trimmedId()));
  const canSubmit = createMemo(
    () => trimmedId() !== "" && idValid() && trimmedModelID() !== "" && !submitting(),
  );
  // A key without a base URL is sent to the provider's built-in endpoint.
  const showApiKeyHint = () => apiKey().trim() !== "" && baseURL().trim() === "";

  async function submit(): Promise<void> {
    if (!canSubmit()) return;
    setSubmitting(true);
    setError(null);
    try {
      const patch: ConfigPatch = buildProviderPatch(trimmedId(), {
        id: trimmedId(),
        name: name(),
        npm: npm(),
        baseURL: baseURL(),
        apiKey: apiKey(),
        modelID: trimmedModelID(),
        modelName: modelName(),
      });
      await (scope() === "global" ? config.updateGlobal(patch) : config.update(patch));
      // Re-fetch the catalog so the new provider shows up in the list and
      // the Models section (setProviders replaces the full catalog).
      const list = await providers.list();
      setProviders(props.serverId, list);
      props.onAdded?.(trimmedId());
      createToast(t("settings:providerAdded"), "success");
      props.onClose();
    } catch (err) {
      setError(
        t("settings:providerAddFailed", {
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "min-w-0 w-full rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs outline-none placeholder:text-fg-faint focus:border-fg-faint disabled:opacity-50";

  return (
    <Dialog.Root open onOpenChange={props.onClose}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="provider-add-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto p-5"
        >
          <Dialog.Title class="text-md font-semibold">{t("settings:addProvider")}</Dialog.Title>

          <div class="flex flex-col gap-2">
            <input
              data-testid="provider-add-id"
              type="text"
              value={id()}
              placeholder={t("settings:providerId")}
              aria-label={t("settings:providerId")}
              disabled={submitting()}
              onInput={(event) => {
                setIdTouched(true);
                setId(event.currentTarget.value);
              }}
              class={inputClass}
            />
            <Show when={idTouched() && (trimmedId() === "" || !idValid())}>
              <p data-testid="provider-add-id-hint" class="text-[10px] text-fg-faint">
                {trimmedId() === ""
                  ? t("settings:providerIdRequired")
                  : t("settings:providerIdHint")}
              </p>
            </Show>

            <input
              data-testid="provider-add-name"
              type="text"
              value={name()}
              placeholder={t("settings:providerName")}
              aria-label={t("settings:providerName")}
              disabled={submitting()}
              onInput={(event) => setName(event.currentTarget.value)}
              class={inputClass}
            />

            <input
              data-testid="provider-add-npm"
              type="text"
              value={npm()}
              placeholder={t("settings:providerPackage")}
              aria-label={t("settings:providerPackage")}
              disabled={submitting()}
              onInput={(event) => setNpm(event.currentTarget.value)}
              class={inputClass}
            />

            <input
              data-testid="provider-add-baseurl"
              type="text"
              value={baseURL()}
              placeholder={t("settings:providerBaseUrl")}
              aria-label={t("settings:providerBaseUrl")}
              disabled={submitting()}
              onInput={(event) => setBaseURL(event.currentTarget.value)}
              class={inputClass}
            />

            <input
              data-testid="provider-add-apikey"
              type="password"
              autocomplete="new-password"
              value={apiKey()}
              placeholder={t("settings:providerApiKey")}
              aria-label={t("settings:providerApiKey")}
              disabled={submitting()}
              onInput={(event) => setApiKey(event.currentTarget.value)}
              class={inputClass}
            />
            <Show when={showApiKeyHint()}>
              <p data-testid="provider-add-apikey-hint" class="text-[10px] text-fg-faint">
                {t("settings:apiKeyHint")}
              </p>
            </Show>

            <input
              data-testid="provider-add-model-id"
              type="text"
              value={modelID()}
              placeholder={t("settings:providerModelId")}
              aria-label={t("settings:providerModelId")}
              disabled={submitting()}
              onInput={(event) => {
                setModelTouched(true);
                setModelID(event.currentTarget.value);
              }}
              class={inputClass}
            />
            <Show when={modelTouched() && trimmedModelID() === ""}>
              <p data-testid="provider-add-model-id-hint" class="text-[10px] text-fg-faint">
                {t("settings:providerModelIdRequired")}
              </p>
            </Show>

            <input
              data-testid="provider-add-model-name"
              type="text"
              value={modelName()}
              placeholder={t("settings:providerModelName")}
              aria-label={t("settings:providerModelName")}
              disabled={submitting()}
              onInput={(event) => setModelName(event.currentTarget.value)}
              class={inputClass}
            />

            <div class="flex items-center gap-2">
              <span class="text-xs text-fg-secondary">{t("settings:providerScope")}</span>
              <div class="flex gap-1.5">
                <button
                  type="button"
                  data-testid="provider-add-scope-global"
                  aria-pressed={scope() === "global" ? "true" : "false"}
                  disabled={submitting()}
                  onClick={() => setScope("global")}
                  class={`rounded-md border px-2.5 py-1 text-[11px] outline-none transition-colors disabled:opacity-50 ${
                    scope() === "global"
                      ? "border-accent bg-accent-soft text-fg-primary"
                      : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  {t("settings:providerScopeGlobal")}
                </button>
                <button
                  type="button"
                  data-testid="provider-add-scope-project"
                  aria-pressed={scope() === "project" ? "true" : "false"}
                  disabled={submitting()}
                  onClick={() => setScope("project")}
                  class={`rounded-md border px-2.5 py-1 text-[11px] outline-none transition-colors disabled:opacity-50 ${
                    scope() === "project"
                      ? "border-accent bg-accent-soft text-fg-primary"
                      : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  {t("settings:providerScopeProject")}
                </button>
              </div>
            </div>
          </div>

          <Show when={error() !== null}>
            <p data-testid="provider-add-error" class="text-xs text-danger">
              {error()}
            </p>
          </Show>

          <div class="flex justify-end gap-2 pt-1">
            <Dialog.CloseButton
              data-testid="provider-add-cancel"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary outline-none hover:text-fg-primary"
            >
              {t("common:cancel")}
            </Dialog.CloseButton>
            <button
              type="button"
              data-testid="provider-add-submit"
              disabled={!canSubmit()}
              onClick={() => void submit()}
              class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-fg-primary outline-none hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting() ? t("settings:submitting") : t("settings:addProvider")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default AddProviderDialog;
