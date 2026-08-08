// OAuth authorization dialog (TASK-UI-01): the RFC 9728 consent flow for
// a server protected by OAuth (e.g. Cloudflare Access managed OAuth).
//
// Flow: `oauth_authorize` builds the authorization URL with PKCE + state
// (the verifier stays in the Rust process) → the system browser opens the
// URL → the user authenticates and the browser redirects to the loopback
// redirect URI with `?code=...&state=...` → the user pastes the code back
// (or the redirect URL with the code) → `oauth_exchange` swaps it for
// tokens and stores them on the server entry → the dialog reports success.
//
// The dialog is mounted wherever a server needs OAuth: the Add Server
// flow (discovery found an authorization server), the re-auth path when a
// saved server answers 401/403 (its entry has OAuth credentials), and the
// manual "Re-authenticate" action on a server card.

import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT } from "../../i18n";
import { authorizeOAuth, exchangeOAuth } from "../../services/servers";
import type { OAuthAuthorizeResult } from "../../services/servers";

export interface ServerOAuthDialogProps {
  /** The server being authorized. */
  serverId: string;
  /** Human-readable name shown in the header. */
  serverName: string;
  /** Closes the dialog (cancel, Esc, backdrop, success). */
  onClose: () => void;
  /** The OAuth flow succeeded — tokens are stored. */
  onAuthorized: () => void;
}

const ServerOAuthDialog: Component<ServerOAuthDialogProps> = (props) => {
  const t = useT();
  const [starting, setStarting] = createSignal(false);
  const [authorizing, setAuthorizing] = createSignal(false);
  const [codeDraft, setCodeDraft] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [authResult, setAuthResult] = createSignal<OAuthAuthorizeResult | null>(null);

  const canSubmit = () => codeDraft().trim().length > 0 && !submitting();

  /** Starts the authorization: builds the URL and opens the browser. */
  async function start(): Promise<void> {
    if (starting() || authorizing()) return;
    setStarting(true);
    setError(null);
    try {
      const result = await authorizeOAuth(props.serverId);
      setAuthResult(result);
      setStarting(false);
      setAuthorizing(true);
      await openUrl(result.authorizationUrl);
    } catch {
      setStarting(false);
      setError(t("servers:oauthStartFailed"));
    }
  }

  /**
   * Exchanges the pasted code for tokens. The code input accepts either
   * the bare code or the full redirect URL (the user may paste the whole
   * browser address); the state/verifier live in the Rust process.
   */
  async function submitCode(): Promise<void> {
    const raw = codeDraft().trim();
    if (raw === "" || submitting()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { code, state } = parseCallback(raw);
      await exchangeOAuth(props.serverId, code, state);
      props.onAuthorized();
      props.onClose();
    } catch {
      setError(t("servers:oauthCodeRejected"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={props.onClose}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="server-oauth-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-5"
        >
          <Dialog.Title class="text-md font-semibold">
            {t("servers:oauthSignInTo", { name: props.serverName })}
          </Dialog.Title>
          <Dialog.Description class="text-sm text-fg-secondary">
            {t("servers:oauthDescription", { name: props.serverName })}
          </Dialog.Description>

          <Show when={starting()}>
            <p data-testid="server-oauth-starting" class="text-xs text-fg-secondary">
              {t("servers:oauthStarting")}
            </p>
          </Show>

          <Show when={authorizing() && authResult() !== null}>
            <div class="flex items-center gap-2">
              <input
                data-testid="server-oauth-code-input"
                type="text"
                value={codeDraft()}
                placeholder={t("servers:pasteAuthorizationCode")}
                aria-label={t("servers:authorizationCode")}
                disabled={submitting()}
                onInput={(event) => setCodeDraft(event.currentTarget.value)}
                class="min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1.5 text-xs outline-none placeholder:text-fg-faint focus:border-fg-faint disabled:opacity-50"
              />
              <button
                type="button"
                data-testid="server-oauth-code-submit"
                disabled={!canSubmit()}
                onClick={() => void submitCode()}
                class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-xs text-fg-secondary outline-none hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting() ? t("servers:submitting") : t("servers:submit")}
              </button>
            </div>
          </Show>

          <Show when={error() !== null}>
            <p data-testid="server-oauth-error" class="text-xs text-danger">
              {error()}
            </p>
          </Show>

          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              data-testid="server-oauth-open-browser"
              disabled={starting() || authorizing()}
              onClick={() => void start()}
              class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary outline-none hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("servers:oauthOpenBrowser")}
            </button>
            <Dialog.CloseButton
              data-testid="server-oauth-cancel"
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

/**
 * Extracts the authorization code and state from a callback payload. The
 * user may paste either the bare code or the full redirect URL (with
 * `?code=...&state=...` query params).
 */
export function parseCallback(raw: string): { code: string; state: string } {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { code: trimmed, state: "" };
  }
  const code = url.searchParams.get("code") ?? trimmed;
  const state = url.searchParams.get("state") ?? "";
  return { code, state };
}

export default ServerOAuthDialog;
