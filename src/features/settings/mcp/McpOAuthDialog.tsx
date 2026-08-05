// MCP OAuth authorization dialog (TASK-M9-06): mounted for a needs_auth
// MCP server, it POSTs /mcp/{name}/auth, opens the returned authorization
// URL in the system browser (opener plugin) and then polls POST
// /mcp/{name}/auth/authenticate (with the mock `poll` query extension —
// see docs/api-coverage.md §5) every 2s up to 60s until the status turns
// connected (auto flow), while a code input stays available as the
// alternative completion path (POST /mcp/{name}/auth/callback with the
// code — the server declares no flow kind, so both are always offered).
// Success closes the dialog and reports through onAuthorized (the parent
// refreshes the status list); failure shows an inline error; cancel/unmount
// aborts any in-flight polling. The flow logic reuses the TASK-M5-07
// pollUntil helper from the provider OAuth flow.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getApiClient } from "../../../services/client.js";
import { createMcpService } from "../../../services/mcp.js";
import { pollUntil } from "../providers/oauth.js";
import { useT } from "../../../i18n/index.js";

export interface McpOAuthDialogProps {
  /** Name of the MCP server to authorize. */
  serverName: string;
  /** Closes the dialog (cancel, Esc, backdrop). */
  onClose: () => void;
  /** The OAuth flow succeeded — the parent refreshes the status list. */
  onAuthorized: () => void;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

const McpOAuthDialog: Component<McpOAuthDialogProps> = (props) => {
  const t = useT();
  const service = createMcpService(getApiClient());
  // Auth start POST in flight (starting state).
  const [starting, setStarting] = createSignal(false);
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

  /** Authorization succeeded — report and close. */
  function succeed(): void {
    props.onAuthorized();
    props.onClose();
  }

  // The poll closure reads plain locals (the props are constant for the
  // dialog's lifetime), so the loop stays outside reactive tracking.
  async function pollUntilAuthorized(serverName: string): Promise<void> {
    setPolling(true);
    const controller = new AbortController();
    pollController = controller;
    const ok = await pollUntil(
      async () => (await service.authPoll(serverName)).status === "connected",
      { intervalMs: POLL_INTERVAL_MS, timeoutMs: POLL_TIMEOUT_MS, signal: controller.signal },
    );
    pollController = null;
    // Cancelled (cancel/unmount) — the caller closed the dialog; stay silent.
    if (controller.signal.aborted) return;
    setPolling(false);
    if (!ok) {
      setError(t("settings:oauthTimeout"));
      return;
    }
    succeed();
  }

  async function start(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      const auth = await service.authStart(props.serverName);
      await openUrl(auth.authorizationUrl);
      await pollUntilAuthorized(props.serverName);
    } catch {
      setError(t("settings:oauthStartFailed"));
    } finally {
      setStarting(false);
    }
  }

  onMount(() => {
    void start();
  });

  /** Submitting a code aborts the auto poll and completes via the callback. */
  async function submitCode(): Promise<void> {
    const code = codeDraft().trim();
    if (code === "" || submitting()) return;
    stopPolling();
    setPolling(false);
    setSubmitting(true);
    setError(null);
    try {
      const status = await service.authCallback(props.serverName, code);
      if (status.status !== "connected") {
        setError(t("settings:oauthCodeRejected"));
        return;
      }
      succeed();
    } catch {
      setError(t("settings:oauthCodeFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={props.onClose}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="mcp-oauth-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-5"
        >
          <Dialog.Title class="text-md font-semibold">
            {t("settings:oauthSignInTo", { name: props.serverName })}
          </Dialog.Title>
          <Dialog.Description class="text-sm text-fg-secondary">
            {t("settings:oauthDescription", { name: props.serverName })}
          </Dialog.Description>

          <Show when={starting()}>
            <p data-testid="mcp-oauth-starting" class="text-xs text-fg-secondary">
              {t("settings:oauthStarting")}
            </p>
          </Show>

          <Show when={polling()}>
            <p data-testid="mcp-oauth-waiting" class="text-xs text-fg-secondary">
              {t("settings:oauthWaiting")}
            </p>
          </Show>

          <div class="flex items-center gap-2">
            <input
              data-testid="mcp-oauth-code-input"
              type="text"
              value={codeDraft()}
              placeholder={t("settings:pasteAuthorizationCode")}
              aria-label={t("settings:authorizationCode")}
              disabled={submitting()}
              onInput={(event) => setCodeDraft(event.currentTarget.value)}
              class="min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs outline-none placeholder:text-fg-faint focus:border-fg-faint disabled:opacity-50"
            />
            <button
              type="button"
              data-testid="mcp-oauth-code-submit"
              disabled={codeDraft().trim() === "" || submitting()}
              onClick={() => void submitCode()}
              class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting() ? t("settings:submitting") : t("settings:submit")}
            </button>
          </div>

          <Show when={error() !== null}>
            <p data-testid="mcp-oauth-error" class="text-xs text-danger">
              {error()}
            </p>
          </Show>

          <div class="flex justify-end pt-1">
            <Dialog.CloseButton
              data-testid="mcp-oauth-cancel"
              class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary outline-none hover:text-fg-primary"
            >
              {t("common:cancel")}
            </Dialog.CloseButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default McpOAuthDialog;
