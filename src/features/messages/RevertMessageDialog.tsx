// Revert message dialog (TASK-M6-04): second confirmation before reverting
// a session to a message point — the copy notes that file changes made after
// the point are rolled back on the server. The dialog is presentational:
// the caller (DesktopShell) supplies the revert round-trip via onConfirm and
// keeps the dialog open with the inline error when it rejects. Mounted per
// target message (Show keyed in the caller).

import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { ApiError } from "../../services/errors";
import { useErrorCopy } from "../../components/errorCopy";
import { useT } from "../../i18n";

export interface RevertMessageDialogProps {
  /** The message the session will be reverted to (shown in the copy). */
  messageID: string;
  /** Performs the revert; resolves on success, rejects with ApiError. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

const actionClass =
  "rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm " +
  "text-fg-secondary hover:text-fg-primary";

const RevertMessageDialog: Component<RevertMessageDialogProps> = (props) => {
  const t = useT();
  const { line: errorLine } = useErrorCopy();
  const [reverting, setReverting] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);

  async function onRevert() {
    if (reverting()) return;
    setReverting(true);
    setError(null);
    try {
      await props.onConfirm();
      props.onClose();
    } catch (err) {
      setError(ApiError.fromUnknown(err));
      setReverting(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        // Esc / overlay / CloseButton while reverting must not orphan the
        // in-flight POST; the guard in onRevert is the backstop.
        if (!open && !reverting()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="revert-message-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title class="text-md font-semibold">
            {t("messages:revertMessageTitle", { id: props.messageID })}
          </Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            {t("messages:revertMessageBody")}
          </Dialog.Description>

          <Show when={error()}>
            <p data-testid="revert-message-error" class="mt-4 text-sm text-danger">
              {errorLine(error()!)}
            </p>
          </Show>
          <div class="flex justify-end gap-3 pt-5">
            <Dialog.CloseButton
              data-testid="revert-message-cancel"
              class={actionClass}
              disabled={reverting()}
            >
              Cancel
            </Dialog.CloseButton>
            <button
              data-testid="revert-message-confirm"
              type="button"
              class="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={reverting()}
              onClick={onRevert}
            >
              {reverting() ? t("messages:reverting") : t("messages:revert")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default RevertMessageDialog;
