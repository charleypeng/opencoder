// Provider API key management (TASK-M5-06/07): lists the server's providers
// with their connected state and renders the auth UI per
// ProviderAuthMethod — an API key form (password input + Save, plus a
// Remove button with inline confirmation) for `api` methods and an
// Authorize button opening the OAuth dialog (TASK-M5-07) for `oauth`
// methods. The key value is never fetched (the contract has no key GET); a
// stored key is indicated by the connected badge and a "Key set" hint.
// Saving/removing a key or completing an OAuth flow re-lists the providers
// through the models store so the connected state refreshes.

import { createSignal, For, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import {
  createProviderService,
  type Provider,
  type ProviderAuthMethod,
} from "../../../services/provider.js";
import { getApiClient } from "../../../services/client.js";
import { getServerModelState, setProviders } from "../../../stores/models.js";
import ProviderOAuth from "./ProviderOAuth.js";

export interface ProviderKeysProps {
  /** The server whose provider keys are managed. */
  serverId: string;
}

const ProviderKeys: Component<ProviderKeysProps> = (props) => {
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
      setError(`Failed to remove the key for ${providerID}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section data-testid="provider-keys" class="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="text-sm font-semibold">Providers</h2>
        <Show when={!loadFailed()}>
          <button
            type="button"
            data-testid="provider-keys-refresh"
            class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </Show>
      </div>

      <Show
        when={!loadFailed()}
        fallback={
          <div
            data-testid="provider-keys-load-error"
            class="flex flex-col items-start gap-2 rounded-md border border-bg-sunken bg-bg-elevated p-3 text-xs"
          >
            <p class="text-fg-secondary">Failed to load providers.</p>
            <button
              type="button"
              data-testid="provider-keys-retry"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary"
              onClick={() => void load()}
            >
              Retry
            </button>
          </div>
        }
      >
        <Show
          when={getServerModelState(props.serverId).providers.length > 0}
          fallback={
            <p data-testid="provider-keys-empty" class="text-xs text-fg-faint">
              No providers available.
            </p>
          }
        >
          <ul class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            <For each={getServerModelState(props.serverId).providers}>
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
                    class="rounded-md border border-bg-sunken bg-bg-elevated p-3"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <h3 class="text-sm font-medium">{provider.name}</h3>
                      <span class="flex items-center gap-1.5">
                        <Show when={connected()}>
                          <span
                            data-testid="provider-key-set"
                            class="rounded border border-bg-sunken bg-bg-sunken px-1.5 py-px text-[10px] text-fg-secondary"
                          >
                            Key set
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
                          {connected() ? "Connected" : "Not connected"}
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
                          aria-label={`${provider.name} API key`}
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
                          {isBusy() ? "Saving…" : "Save"}
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
                            {confirming() ? "Confirm remove" : "Remove"}
                          </button>
                          <Show when={confirming()}>
                            <button
                              type="button"
                              data-testid="provider-key-remove-cancel"
                              class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary"
                              onClick={() => setConfirmRemove(null)}
                            >
                              Cancel
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
        </Show>

        <Show when={oauthTarget() !== null}>
          <ProviderOAuth
            provider={oauthTarget()!.provider}
            methodIndex={oauthTarget()!.methodIndex}
            onClose={() => setOauthTarget(null)}
            onAuthorized={() => void refreshProviders()}
          />
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
