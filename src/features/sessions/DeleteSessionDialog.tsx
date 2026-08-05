// Delete session dialog (TASK-M2-05): second confirmation before removing
// a session. The store is updated optimistically by deleteSession before
// the DELETE round-trip; a failure rolls the store back and shows the
// error inline. Mounted per target session (Show keyed).

import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { getApiClient } from "../../services/client";
import { ApiError } from "../../services/errors";
import { useErrorCopy } from "../../components/errorCopy";
import { useT } from "../../i18n";
import type { Session } from "../../services/session";
import { createSessionService } from "../../services/session";
import { deleteSession } from "./sessionActions";

export interface DeleteSessionDialogProps {
  /** The server whose session is being deleted. */
  serverId: string;
  /** The session being deleted (always present while mounted). */
  session: Session;
  onClose: () => void;
}

const actionClass =
  "rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm " +
  "text-fg-secondary hover:text-fg-primary";

const DeleteSessionDialog: Component<DeleteSessionDialogProps> = (props) => {
  const t = useT();
  const { line: errorLine } = useErrorCopy();
  const [deleting, setDeleting] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);

  async function onDelete() {
    if (deleting()) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSession(props.serverId, props.session.id, createSessionService(getApiClient()));
      props.onClose();
    } catch (err) {
      setError(ApiError.fromUnknown(err));
      setDeleting(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        // Esc / overlay / CloseButton while deleting must not orphan the
        // in-flight DELETE; the guard in onDelete is the backstop.
        if (!open && !deleting()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="delete-session-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title class="text-md font-semibold">
            {t("sessions:deleteSessionTitle")}
          </Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            {t("sessions:deleteSessionBody", { title: props.session.title || props.session.slug })}
          </Dialog.Description>

          <Show when={error()}>
            <p data-testid="delete-session-error" class="mt-4 text-sm text-danger">
              {errorLine(error()!)}
            </p>
          </Show>
          <div class="flex justify-end gap-3 pt-5">
            <Dialog.CloseButton
              data-testid="delete-session-cancel"
              class={actionClass}
              disabled={deleting()}
            >
              Cancel
            </Dialog.CloseButton>
            <button
              data-testid="delete-session-confirm"
              type="button"
              class="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={deleting()}
              onClick={onDelete}
            >
              {deleting() ? t("sessions:deleting") : t("common:delete")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default DeleteSessionDialog;
