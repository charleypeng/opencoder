// Server connect QR dialog (TASK-M7-08): Kobalte dialog opened from the
// server card menu ("Show QR code"). Renders the `opencode://connect` QR
// code (url + name only — credentials never enter the payload) with a copy
// button and a note; the scanning device must be able to reach the server.
// Mirrors the ShareSessionDialog QR/copy conventions.

import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import QRCode from "qrcode";
import type { ServerEntry } from "../../services/servers";
import { useT } from "../../i18n";
import { encodeConnectUrl } from "./qrConnect";

export interface ServerQrDialogProps {
  /** The server whose connect QR is shown. */
  server: ServerEntry;
  onClose: () => void;
}

const actionClass =
  "rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm " +
  "text-fg-secondary hover:text-fg-primary";

/** Copies text via the async Clipboard API with a legacy execCommand
 *  fallback (mirrors ShareSessionDialog / MessageActions). */
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

const ServerQrDialog: Component<ServerQrDialogProps> = (props) => {
  const t = useT();
  const connectUrl = () => encodeConnectUrl({ url: props.server.url, name: props.server.name });

  const [qrSrc, setQrSrc] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);

  // QR generation is async; regenerate whenever the server changes and drop
  // stale generations (stale flag cleared by onCleanup on re-run/unmount).
  createEffect(() => {
    const url = connectUrl();
    let stale = false;
    QRCode.toDataURL(url, { width: 160, margin: 1 })
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

  async function handleCopy() {
    const ok = await copyToClipboard(connectUrl());
    setCopied(ok);
    if (ok) {
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="server-qr-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title class="text-md font-semibold">{t("servers:shareServer")}</Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            {props.server.name} · {props.server.url}
          </Dialog.Description>

          <div class="mt-5 space-y-4">
            <div class="flex items-center gap-2">
              <input
                data-testid="server-qr-connect-url"
                readOnly
                value={connectUrl()}
                aria-label={t("servers:connectUrl")}
                class="min-w-0 flex-1 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 font-code text-xs text-fg-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <button
                type="button"
                data-testid="server-qr-copy"
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
                  <p data-testid="server-qr-missing" class="text-xs text-fg-faint">
                    {t("servers:qrUnavailable")}
                  </p>
                }
              >
                <img
                  data-testid="server-qr-img"
                  src={qrSrc()!}
                  alt={t("servers:qrAlt")}
                  class="h-40 w-40"
                />
              </Show>
            </div>
            <p class="text-xs text-fg-faint">{t("servers:qrHint")}</p>
            <div class="flex justify-end gap-3 pt-1">
              <Dialog.CloseButton data-testid="server-qr-close" class={actionClass}>
                {t("common:close")}
              </Dialog.CloseButton>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default ServerQrDialog;
