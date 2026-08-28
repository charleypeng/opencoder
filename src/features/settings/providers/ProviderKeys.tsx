// Provider API key management (TASK-M5-06/07): lists the server's providers
// with their connected state and renders the auth UI per
// ProviderAuthMethod — an API key form (password input + Save, plus a
// Remove button with inline confirmation) for `api` methods and an
// Authorize button opening the OAuth dialog (TASK-M5-07) for `oauth`
// methods. The key value is never fetched (the contract has no key GET); a
// stored key is indicated by the connected badge and a "Key set" hint.
// Saving/removing a key or completing an OAuth flow re-lists the providers
// through the models store so the connected state refreshes.

import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import {
  createProviderService,
  type Provider,
  type ProviderAuthMethod,
} from "../../../services/provider.js";
import { getApiClient } from "../../../services/client.js";
import { getServerModelState, setProviders } from "../../../stores/models.js";
import ProviderOAuth from "./ProviderOAuth.js";
import AddProviderDialog from "./AddProviderDialog.js";
import { useT } from "../../../i18n/index.js";

export interface ProviderKeysProps {
  /** The server whose provider keys are managed. */
  serverId: string;
}

const ProviderKeys: Component<ProviderKeysProps> = (props) => {
  const t = useT();
  const service = createProviderService(getApiClient());
  // Per-provider auth methods from GET /provider/auth.
  const [authMethods, setAuthMethods] = createSignal<Record<string, ProviderAuthMethod[]>>({});
  // Password input drafts keyed by provider id.
  const [drafts, setDrafts] = createSignal<Record<string, string>>({});
  // Provider whose key mutation (save or remove) is in flight.
  const [busy, setBusy] = createSignal<string | null>(null);
  // Provider awaiting the second remove confirmation click.
  const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null);
  // Provider whose OAuth dialog is open (with its oauth method index).
  const [oauthTarget, setOauthTarget] = createSignal<{
    provider: Provider;
    methodIndex: number;
  } | null>(null);
  // The "Add provider" dialog is open (TASK-S1-02).
  const [addOpen, setAddOpen] = createSignal(false);
  // Provider whose edit dialog is open (docs feedback: double-click a row
  // to edit its key/connection without hunting for the inline form).
  const [editTarget, setEditTarget] = createSignal<Provider | null>(null);
  // Unconnected providers hide behind a toggle (docs feedback): the common
  // case is managing the CONNECTED set; known-but-unconnected providers are
  // one click away. With no connection at all the full list stays visible
  // (a collapsed empty view would read as "no providers").
  const [showAllProviders, setShowAllProviders] = createSignal(false);
  const connectedSet = createMemo(() => new Set(getServerModelState(props.serverId).connected));
  const visibleProviders = createMemo(() => {
    const all = getServerModelState(props.serverId).providers;
    if (showAllProviders() || connectedSet().size === 0) return all;
    return all.filter((provider) => connectedSet().has(provider.id));
  });
  const hiddenCount = createMemo(
    () => getServerModelState(props.serverId).providers.length - visibleProviders().length,
  );
  const [error, setError] = createSignal<string | null>(null);
  const [loadFailed, setLoadFailed] = createSignal(false);

  /**
   * Refreshes the provider catalog so the connected badges update. The
   * same fetch-version guard as load() drops a stale response that lands
   * after a newer fetch (M5 review).
   */
  async function refreshProviders(): Promise<void> {
    const version = ++fetchVersion;
    const list = await service.list();
    if (version === fetchVersion) setProviders(props.serverId, list);
  }

  let fetchVersion = 0;
  async function load(): Promise<void> {
    const version = ++fetchVersion;
    setLoadFailed(false);
    try {
      const [methods, list] = await Promise.all([service.authMethods(), service.list()]);
      if (version !== fetchVersion) return;
      setAuthMethods(methods);
      setProviders(props.serverId, list);
    } catch {
      if (version === fetchVersion) setLoadFailed(true);
    }
  }

  onMount(load);

  async function saveKey(providerID: string): Promise<void> {
    const key = drafts()[providerID] ?? "";
    if (key.trim() === "" || busy() !== null) return;
    setBusy(providerID);
    setError(null);
    try {
      await service.setKey(providerID, key);
      setDrafts((d) => ({ ...d, [providerID]: "" }));
      await refreshProviders();
    } catch {
      setError(`Failed to save the key for ${providerID}.`);
    } finally {
      setBusy(null);
    }
  }

  async function removeKey(providerID: string): Promise<void> {
    if (busy() !== null) return;
    setBusy(providerID);
    setError(null);
    try {
      await service.removeKey(providerID);
      setConfirmRemove(null);
      await refreshProviders();
    } catch {
      setError(t("settings:removeKeyFailed", { providerID }));
    } finally {
      setBusy(null);
    }
  }

  /** Dialog save: closes on success (saveKey surfaces failures through the
   *  shared error signal, which it clears on entry). */
  async function saveFromDialog(providerID: string): Promise<void> {
    await saveKey(providerID);
    if (error() === null) setEditTarget(null);
  }

  return (
    <section data-testid="provider-keys" class="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="text-sm font-semibold">{t("settings:providers")}</h2>
        <Show when={!loadFailed()}>
          <div class="flex items-center gap-2">
            <button
              type="button"
              data-testid="provider-keys-refresh"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary"
              onClick={() => void load()}
            >
              {t("common:refresh")}
            </button>
            <button
              type="button"
              data-testid="add-provider"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary"
              onClick={() => setAddOpen(true)}
            >
              {t("settings:addProvider")}
            </button>
          </div>
        </Show>
      </div>

      <Show
        when={!loadFailed()}
        fallback={
          <div
            data-testid="provider-keys-load-error"
            class="flex flex-col items-start gap-2 rounded-md border border-bg-sunken bg-bg-elevated p-3 text-xs"
          >
            <p class="text-fg-secondary">{t("settings:providersLoadFailed")}</p>
            <button
              type="button"
              data-testid="provider-keys-retry"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary"
              onClick={() => void load()}
            >
              {t("common:retry")}
            </button>
          </div>
        }
      >
        <Show
          when={getServerModelState(props.serverId).providers.length > 0}
          fallback={
            <p data-testid="provider-keys-empty" class="text-xs text-fg-faint">
              {t("settings:noProviders")}
            </p>
          }
        >
          <ul class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            <For each={visibleProviders()}>
              {(provider: Provider) => {
                const methods = () => authMethods()[provider.id] ?? [];
                const apiMethod = () => methods().find((m) => m.type === "api");
                const oauthMethodIndex = () => methods().findIndex((m) => m.type === "oauth");
                const connected = () =>
                  getServerModelState(props.serverId).connected.includes(provider.id);
                const draft = () => drafts()[provider.id] ?? "";
                const isBusy = () => busy() === provider.id;
                const confirming = () => confirmRemove() === provider.id;
                return (
                  <li
                    data-testid={`provider-key-row-${provider.id}`}
                    data-provider={provider.id}
                    data-connected={connected() ? "true" : "false"}
                    title={t("settings:providerEditHint")}
                    class="cursor-pointer rounded-md border border-bg-sunken bg-bg-elevated p-3"
                    onDblClick={() => setEditTarget(provider)}
                  >
                    <div class="flex items-center justify-between gap-2">
                      <h3 class="text-sm font-medium">{provider.name}</h3>
                      <span class="flex items-center gap-1.5">
                        <Show when={connected()}>
                          <span
                            data-testid="provider-key-set"
                            class="rounded border border-bg-sunken bg-bg-sunken px-1.5 py-px text-[10px] text-fg-secondary"
                          >
                            {t("settings:keySet")}
                          </span>
                        </Show>
                        <span
                          data-testid="provider-connected"
                          class={`rounded border px-1.5 py-px text-[10px] ${
                            connected()
                              ? "border-accent/40 text-accent"
                              : "border-bg-sunken text-fg-faint"
                          }`}
                        >
                          {connected() ? t("models:connected") : t("models:notConnected")}
                        </span>
                      </span>
                    </div>

                    <Show when={apiMethod() !== undefined}>
                      <form
                        class="mt-2 flex items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveKey(provider.id);
                        }}
                      >
                        <input
                          data-testid="provider-key-input"
                          type="password"
                          autocomplete="new-password"
                          value={draft()}
                          placeholder="••••••••"
                          aria-label={t("settings:apiKeyFor", { name: provider.name })}
                          disabled={isBusy()}
                          onInput={(event) =>
                            setDrafts((d) => ({ ...d, [provider.id]: event.currentTarget.value }))
                          }
                          class="min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs outline-none placeholder:text-fg-faint focus:border-fg-faint disabled:opacity-50"
                        />
                        <button
                          type="button"
                          data-testid="provider-key-save"
                          // Any in-flight mutation locks every row's actions
                          // so concurrent saves/removes cannot race (M5 review).
                          disabled={draft().trim() === "" || busy() !== null}
                          class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => void saveKey(provider.id)}
                        >
                          {isBusy() ? t("common:saving") : t("common:save")}
                        </button>
                        <Show when={connected()}>
                          <button
                            type="button"
                            data-testid="provider-key-remove"
                            class={`shrink-0 rounded-md border px-3 py-1.5 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                              confirming()
                                ? "border-danger text-danger"
                                : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
                            }`}
                            disabled={busy() !== null}
                            onClick={() =>
                              confirming()
                                ? void removeKey(provider.id)
                                : setConfirmRemove(provider.id)
                            }
                          >
                            {confirming() ? t("settings:confirmRemove") : t("common:remove")}
                          </button>
                          <Show when={confirming()}>
                            <button
                              type="button"
                              data-testid="provider-key-remove-cancel"
                              class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary"
                              onClick={() => setConfirmRemove(null)}
                            >
                              {t("common:cancel")}
                            </button>
                          </Show>
                        </Show>
                      </form>
                      <Show when={confirming()}>
                        <p
                          data-testid="provider-key-remove-confirm"
                          class="mt-1.5 text-[10px] text-fg-faint"
                        >
                          This removes the stored key and disconnects the provider.
                        </p>
                      </Show>
                    </Show>

                    <Show when={oauthMethodIndex() !== -1}>
                      <div class="mt-2">
                        <button
                          type="button"
                          data-testid="provider-oauth-authorize"
                          class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary"
                          onClick={() =>
                            setOauthTarget({
                              provider,
                              methodIndex: oauthMethodIndex(),
                            })
                          }
                        >
                          Authorize
                        </button>
                      </div>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
          <Show when={connectedSet().size > 0 && (hiddenCount() > 0 || showAllProviders())}>
            <button
              type="button"
              data-testid="provider-keys-toggle"
              class="shrink-0 self-start text-xs text-fg-secondary outline-none transition-colors hover:text-fg-primary"
              onClick={() => setShowAllProviders((value) => !value)}
            >
              <Show
                when={showAllProviders()}
                fallback={t("settings:showMoreProviders", { count: hiddenCount() })}
              >
                {t("settings:showFewerProviders")}
              </Show>
            </button>
          </Show>
        </Show>

        <Show when={oauthTarget() !== null}>
          <ProviderOAuth
            provider={oauthTarget()!.provider}
            methodIndex={oauthTarget()!.methodIndex}
            onClose={() => setOauthTarget(null)}
            onAuthorized={() => void refreshProviders()}
          />
        </Show>

        {/* Double-click edit dialog (docs feedback): key + connection
            actions for one provider, sharing the inline form's draft and
            busy/confirm state. */}
        <Show when={editTarget() !== null}>
          <Dialog.Root
            open
            onOpenChange={(open) => {
              if (!open) setEditTarget(null);
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
              <Dialog.Content
                data-testid="provider-edit-dialog"
                class="glass fixed left-1/2 top-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg p-5"
              >
                <Dialog.Title class="text-md font-semibold">
                  {t("settings:editProviderTitle", { name: editTarget()!.name })}
                </Dialog.Title>
                <Dialog.Description class="text-xs text-fg-secondary">
                  {t("settings:providerEditHint")}
                </Dialog.Description>
                <form
                  class="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveFromDialog(editTarget()!.id);
                  }}
                >
                  <input
                    data-testid="provider-edit-key-input"
                    type="password"
                    autocomplete="new-password"
                    value={drafts()[editTarget()!.id] ?? ""}
                    placeholder="••••••••"
                    aria-label={t("settings:apiKeyFor", { name: editTarget()!.name })}
                    disabled={busy() !== null}
                    onInput={(event) =>
                      setDrafts((d) => ({
                        ...d,
                        [editTarget()!.id]: event.currentTarget.value,
                      }))
                    }
                    class="min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs outline-none placeholder:text-fg-faint focus:border-fg-faint disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    data-testid="provider-edit-save"
                    disabled={(drafts()[editTarget()!.id] ?? "").trim() === "" || busy() !== null}
                    class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy() === editTarget()!.id ? t("common:saving") : t("common:save")}
                  </button>
                </form>
                <div class="flex items-center gap-2">
                  <Show
                    when={
                      connectedSet().has(editTarget()!.id) &&
                      (authMethods()[editTarget()!.id] ?? []).some((m) => m.type === "api")
                    }
                  >
                    <button
                      type="button"
                      data-testid="provider-edit-remove"
                      class={`shrink-0 rounded-md border px-3 py-1.5 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                        confirmRemove() === editTarget()!.id
                          ? "border-danger text-danger"
                          : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
                      }`}
                      disabled={busy() !== null}
                      onClick={() =>
                        confirmRemove() === editTarget()!.id
                          ? void removeKey(editTarget()!.id)
                          : setConfirmRemove(editTarget()!.id)
                      }
                    >
                      {confirmRemove() === editTarget()!.id
                        ? t("settings:confirmRemove")
                        : t("common:remove")}
                    </button>
                    <Show when={confirmRemove() === editTarget()!.id}>
                      <button
                        type="button"
                        data-testid="provider-edit-remove-cancel"
                        class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary"
                        onClick={() => setConfirmRemove(null)}
                      >
                        {t("common:cancel")}
                      </button>
                    </Show>
                  </Show>
                  <Show
                    when={(authMethods()[editTarget()!.id] ?? []).some((m) => m.type === "oauth")}
                  >
                    <button
                      type="button"
                      data-testid="provider-edit-authorize"
                      class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary"
                      onClick={() => {
                        setOauthTarget({
                          provider: editTarget()!,
                          methodIndex: (authMethods()[editTarget()!.id] ?? []).findIndex(
                            (m) => m.type === "oauth",
                          ),
                        });
                        setEditTarget(null);
                      }}
                    >
                      {t("settings:authorize")}
                    </button>
                  </Show>
                </div>
                <Show when={error() !== null}>
                  <p data-testid="provider-edit-error" class="text-xs text-danger">
                    {error()}
                  </p>
                </Show>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </Show>

        <Show when={addOpen()}>
          <AddProviderDialog serverId={props.serverId} onClose={() => setAddOpen(false)} />
        </Show>

        <Show when={error() !== null}>
          <p data-testid="provider-keys-error" class="text-xs text-danger">
            {error()}
          </p>
        </Show>
      </Show>
    </section>
  );
};

export default ProviderKeys;
