// Share session dialog (TASK-M6-05): Kobalte dialog for the session share
// flow. An unshared session offers the Share action (POST
// /session/{id}/share, no body per the contract); once shared, the dialog
// shows the share URL with a copy button (Clipboard API + execCommand
// fallback, "Copied!" feedback), the QR code generated from the URL
// (`qrcode` → data URL → <img>, for scanning on a mobile device), an
// "Open in browser" button (tauri opener plugin), the Unshare action
// (DELETE /session/{id}/share) and a note that the scanning device must be
// able to reach the server. All state flows through the sessions store:
// share/unshare apply the server's updated session, so the shared badge
// and the URL derive from the contract's `Session.share` marker and the
// dialog flips views reactively; failures surface inline and keep the
// previous state.

import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getApiClient } from "../../services/client";
import { ApiError } from "../../services/errors";
import { useErrorCopy } from "../../components/errorCopy";
import { useT } from "../../i18n";
import type { Session } from "../../services/session";
import { createSessionService } from "../../services/session";
import { getServerSessionState } from "../../stores/session";
import { shareSession, unshareSession } from "./sessionActions";

export interface ShareSessionDialogProps {
  /** The server whose session is being shared. */
  serverId: string;
  /** The session being shared (always present while mounted). */
  session: Session;
  onClose: () => void;
}

const actionClass =
  "rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm " +
  "text-fg-secondary hover:text-fg-primary";

const primaryClass =
  "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/** Copies text via the async Clipboard API with a legacy execCommand
 *  fallback (mirrors MessageActions / MarkdownText). */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

const ShareSessionDialog: Component<ShareSessionDialogProps> = (props) => {
  const t = useT();
  const { line: errorLine } = useErrorCopy();
  // The store session is the source of truth: share/unshare replace it with
  // the server's updated session, so the marker/URL state stays consistent
  // with the server and this dialog flips views reactively.
  const current = () =>
    getServerSessionState(props.serverId).sessions[props.session.id] ?? props.session;
  const shareUrl = () => current().share?.url;

  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);
  const [qrSrc, setQrSrc] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);

  // QR generation is async; regenerate whenever the share URL changes and
  // clear when the session is unshared (stale generations are dropped).
  // TASK-M9-08: `qrcode` is imported dynamically so the ~100KB library
  // stays out of the startup chunk (dialogs only, docs/performance.md).
  createEffect(() => {
    const url = shareUrl();
    if (url === undefined) {
      setQrSrc(null);
      return;
    }
    let stale = false;
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(url, { width: 160, margin: 1 }))
      .then((dataUrl) => {
        if (!stale) setQrSrc(dataUrl);
      })
      .catch(() => {
        if (!stale) setQrSrc(null);
      });
    onCleanup(() => {
      stale = true;
    });
  });

  async function handleShare() {
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      await shareSession(props.serverId, props.session.id, createSessionService(getApiClient()));
    } catch (err) {
      setError(ApiError.fromUnknown(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnshare() {
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      await unshareSession(props.serverId, props.session.id, createSessionService(getApiClient()));
    } catch (err) {
      setError(ApiError.fromUnknown(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    const url = shareUrl();
    if (url === undefined) return;
    const ok = await copyToClipboard(url);
    setCopied(ok);
    if (ok) {
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  async function handleOpen() {
    const url = shareUrl();
    if (url === undefined) return;
    setError(null);
    try {
      await openUrl(url);
    } catch (err) {
      setError(ApiError.fromUnknown(err));
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        // Esc / overlay / CloseButton while a share/unshare round-trip is
        // in flight must not orphan it; the busy guard is the backstop.
        if (!open && !busy()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="share-session-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title class="text-md font-semibold">
            {t("sessions:shareSessionTitle")}
          </Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            {props.session.title || props.session.slug}
          </Dialog.Description>

          <div class="mt-5 space-y-4">
            <Show
              when={shareUrl()}
              fallback={
                <div class="flex flex-col items-center gap-3 py-2">
                  <p class="text-sm text-fg-secondary">{t("sessions:shareHint")}</p>
                  <button
                    type="button"
                    data-testid="share-action"
                    class={primaryClass}
                    disabled={busy()}
                    onClick={handleShare}
                  >
                    {busy() ? t("sessions:sharing") : t("sessions:shareSessionTitle")}
                  </button>
                </div>
              }
            >
              <div class="flex items-center gap-2">
                <input
                  data-testid="share-url"
                  readOnly
                  value={shareUrl()}
                  aria-label={t("sessions:shareUrl")}
                  class="min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 font-code text-xs text-fg-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
                <button
                  type="button"
                  data-testid="share-copy"
                  class={actionClass}
                  onClick={handleCopy}
                >
                  {copied() ? t("common:copied") : t("common:copy")}
                </button>
              </div>
              <div class="flex justify-center">
                <Show
                  when={qrSrc()}
                  fallback={
                    <p data-testid="share-qr-missing" class="text-xs text-fg-faint">
                      {t("servers:qrUnavailable")}
                    </p>
                  }
                >
                  <img
                    data-testid="share-qr"
                    src={qrSrc()!}
                    alt={t("sessions:qrAltShare")}
                    class="h-40 w-40"
                  />
                </Show>
              </div>
              <button
                type="button"
                data-testid="share-open"
                class={actionClass}
                onClick={handleOpen}
              >
                {t("sessions:openInBrowser")}
              </button>
              <p class="text-xs text-fg-faint">{t("sessions:qrHintShare")}</p>
              <button
                type="button"
                data-testid="share-unshare"
                class={primaryClass}
                disabled={busy()}
                onClick={handleUnshare}
              >
                {busy() ? t("sessions:unsharing") : t("sessions:unshare")}
              </button>
            </Show>
            <Show when={error()}>
              <p data-testid="share-error" class="text-sm text-danger">
                {errorLine(error()!)}
              </p>
            </Show>
            <div class="flex justify-end gap-3 pt-1">
              <Dialog.CloseButton data-testid="share-close" class={actionClass} disabled={busy()}>
                {t("common:close")}
              </Dialog.CloseButton>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default ShareSessionDialog;
