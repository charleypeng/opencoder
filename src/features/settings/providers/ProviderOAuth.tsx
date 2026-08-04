// OAuth authorization dialog (TASK-M5-07): mounted for an oauth-type
// auth method, it POSTs the authorize endpoint, opens the returned URL in
// the system browser (opener plugin) and then either polls the callback
// every 2s up to 60s (auto flow — the mock `poll: true` extension, see
// docs/api-coverage.md §5) or asks the user to paste the authorization
// code and submits it (code flow). Success closes the dialog and reports
// through onAuthorized (the parent refreshes the provider list so the
// connected state updates); failure shows an inline error; cancel/unmount
// aborts any in-flight polling.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getApiClient } from "../../../services/client.js";
import { createProviderService, type Provider } from "../../../services/provider.js";
import { pollUntil } from "./oauth.js";

export interface ProviderOAuthProps {
  provider: Provider;
  /** Index of the oauth method within the provider's auth-method list. */
  methodIndex: number;
  /** Closes the dialog (cancel, Esc, backdrop). */
  onClose: () => void;
  /** The OAuth callback succeeded — the parent refreshes the list. */
  onAuthorized: () => void;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

const ProviderOAuth: Component<ProviderOAuthProps> = (props) => {
  const service = createProviderService(getApiClient());
  // Authorize POST in flight (starting state).
  const [starting, setStarting] = createSignal(false);
  // Flow kind the server picked: "auto" polls, "code" asks for a code.
  const [flow, setFlow] = createSignal<"auto" | "code" | null>(null);
  const [instructions, setInstructions] = createSignal("");
  const [polling, setPolling] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [codeDraft, setCodeDraft] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  let pollController: AbortController | null = null;

  function stopPolling(): void {
    pollController?.abort();
    pollController = null;
  }

  onCleanup(stopPolling);

  /** Authorize succeeded — report and close. */
  function succeed(): void {
    props.onAuthorized();
    props.onClose();
  }

  // The poll closure reads plain locals (the props are constant for the
  // dialog's lifetime), so the loop stays outside reactive tracking.
  async function pollUntilAuthorized(providerID: string, methodIndex: number): Promise<void> {
    setPolling(true);
    const controller = new AbortController();
    pollController = controller;
    const ok = await pollUntil(() => service.oauthPoll(providerID, methodIndex), {
      intervalMs: POLL_INTERVAL_MS,
      timeoutMs: POLL_TIMEOUT_MS,
      signal: controller.signal,
    });
    pollController = null;
    // Cancelled (cancel/unmount) — the caller closed the dialog; stay silent.
    if (controller.signal.aborted) return;
    setPolling(false);
    if (!ok) {
      setError("Timed out waiting for the browser authorization to complete.");
      return;
    }
    succeed();
  }

  async function start(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      const auth = await service.oauthAuthorize(props.provider.id, props.methodIndex);
      setFlow(auth.method);
      setInstructions(auth.instructions);
      await openUrl(auth.url);
      if (auth.method === "auto") await pollUntilAuthorized(props.provider.id, props.methodIndex);
    } catch {
      setError("Failed to start the OAuth authorization.");
    } finally {
      setStarting(false);
    }
  }

  onMount(() => {
    void start();
  });

  async function submitCode(): Promise<void> {
    const code = codeDraft().trim();
    if (code === "" || submitting()) return;
    setSubmitting(true);
    setError(null);
    try {
      const ok = await service.oauthCallback(props.provider.id, props.methodIndex, code);
      if (!ok) {
        setError("The authorization code was rejected.");
        return;
      }
      succeed();
    } catch {
      setError("Failed to submit the authorization code.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={props.onClose}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="provider-oauth-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-5"
        >
          <Dialog.Title class="text-md font-semibold">
            Sign in to {props.provider.name}
          </Dialog.Title>
          <Dialog.Description class="text-sm text-fg-secondary">
            {props.provider.name} uses OAuth to authenticate this client.
          </Dialog.Description>

          <Show when={starting()}>
            <p data-testid="provider-oauth-starting" class="text-xs text-fg-secondary">
              Starting the OAuth flow…
            </p>
          </Show>

          <Show when={flow() !== null}>
            <p data-testid="provider-oauth-instructions" class="text-xs text-fg-secondary">
              {instructions()}
            </p>
          </Show>

          <Show when={flow() === "auto"}>
            <Show when={polling()}>
              <p data-testid="provider-oauth-waiting" class="text-xs text-fg-secondary">
                Waiting for the browser to complete the authorization…
              </p>
            </Show>
          </Show>

          <Show when={flow() === "code"}>
            <div class="flex items-center gap-2">
              <input
                data-testid="provider-oauth-code-input"
                type="text"
                value={codeDraft()}
                placeholder="Paste the authorization code"
                aria-label="Authorization code"
                disabled={submitting()}
                onInput={(event) => setCodeDraft(event.currentTarget.value)}
                class="min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs outline-none placeholder:text-fg-faint focus:border-fg-faint disabled:opacity-50"
              />
              <button
                type="button"
                data-testid="provider-oauth-code-submit"
                disabled={codeDraft().trim() === "" || submitting()}
                onClick={() => void submitCode()}
                class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting() ? "Submitting…" : "Submit"}
              </button>
            </div>
          </Show>

          <Show when={error() !== null}>
            <p data-testid="provider-oauth-error" class="text-xs text-danger">
              {error()}
            </p>
          </Show>

          <div class="flex justify-end pt-1">
            <Dialog.CloseButton
              data-testid="provider-oauth-cancel"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary outline-none hover:text-fg-primary"
            >
              Cancel
            </Dialog.CloseButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default ProviderOAuth;
