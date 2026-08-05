// Summarize dialog (TASK-M6-06): compress the session's context through
// POST /session/{id}/summarize with a compact model select (connected
// providers only, the session's own model preselected). While the request
// is in flight the dialog locks (disabled confirm + "Compressing…" hint);
// success fires a success toast and closes, failure stays inline. The
// compacted context arrives server-side as the session's `summary`
// (SSE/parts, rendered by the M3-04 compaction part), so this dialog is
// fire-and-confirm only.

import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { getApiClient } from "../../services/client";
import { ApiError } from "../../services/errors";
import { useErrorCopy } from "../../components/errorCopy";
import { useT } from "../../i18n";
import type { Session } from "../../services/session";
import { createSessionService } from "../../services/session";
import { ModelSelect } from "../models/ModelSelect.js";
import type { ModelRef } from "../../stores/models.js";
import { createToast } from "../../stores/toasts.js";

export interface SummarizeDialogProps {
  /** The server whose session is being summarized. */
  serverId: string;
  /** The session being summarized (always present while mounted). */
  session: Session;
  onClose: () => void;
}

const actionClass =
  "rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm " +
  "text-fg-secondary hover:text-fg-primary";

const primaryClass =
  "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const SummarizeDialog: Component<SummarizeDialogProps> = (props) => {
  const t = useT();
  const { line: errorLine } = useErrorCopy();
  const [selection, setSelection] = createSignal<ModelRef | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);

  async function handleConfirm() {
    if (busy()) return;
    const ref = selection();
    if (ref === null) return;
    setBusy(true);
    setError(null);
    try {
      await createSessionService(getApiClient()).summarize(props.session.id, {
        providerID: ref.providerID,
        modelID: ref.modelID,
      });
      createToast(t("sessions:compressedToast"), "success");
      props.onClose();
    } catch (err) {
      setError(ApiError.fromUnknown(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        // Esc / overlay / CloseButton while a summarize round-trip is in
        // flight must not orphan it; the busy guard is the backstop.
        if (!open && !busy()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="summarize-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title class="text-md font-semibold">{t("sessions:compress")}</Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            {props.session.title || props.session.slug}
          </Dialog.Description>

          <div class="mt-5 space-y-4">
            <ModelSelect
              serverId={props.serverId}
              session={props.session}
              value={selection()}
              onChange={setSelection}
            />
            <p class="text-xs text-fg-faint">{t("sessions:summarizeHint")}</p>
            <Show when={error()}>
              <p data-testid="summarize-error" class="text-sm text-danger">
                {errorLine(error()!)}
              </p>
            </Show>
            <div class="flex justify-end gap-3 pt-1">
              <Dialog.CloseButton
                data-testid="summarize-close"
                class={actionClass}
                disabled={busy()}
              >
                {t("common:cancel")}
              </Dialog.CloseButton>
              <button
                type="button"
                data-testid="summarize-confirm"
                class={primaryClass}
                disabled={busy() || selection() === null}
                onClick={handleConfirm}
              >
                {busy() ? t("sessions:compressing") : t("sessions:compress")}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default SummarizeDialog;
