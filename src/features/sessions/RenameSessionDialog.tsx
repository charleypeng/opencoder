// Rename session dialog (TASK-M2-05): Kobalte dialog with the current
// title prefilled; Enter submits, Esc cancels. The store is updated
// optimistically by renameSession before the PATCH round-trip; a failure
// rolls the store back and shows the error inline. Mounted per target
// session (Show keyed), so the one-time prefill is intentional.

import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { getApiClient } from "../../services/client";
import { ApiError, errorDetail, errorTitle } from "../../services/errors";
import type { Session } from "../../services/session";
import { createSessionService } from "../../services/session";
import { renameSession } from "./sessionActions";

export interface RenameSessionDialogProps {
  /** The server whose session is being renamed. */
  serverId: string;
  /** The session being renamed (always present while mounted). */
  session: Session;
  onClose: () => void;
}

const inputClass =
  "mt-1 w-full rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 text-sm text-fg-primary " +
  "placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

const actionClass =
  "rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm " +
  "text-fg-secondary hover:text-fg-primary";

/** "Title: detail" line; the detail is dropped when it duplicates the title. */
function errorLine(err: ApiError): string {
  const title = errorTitle(err);
  const detail = errorDetail(err);
  return detail === title ? title : `${title}: ${detail}`;
}

const RenameSessionDialog: Component<RenameSessionDialogProps> = (props) => {
  // Mounted per target session (Show keyed), so one-time prefill is
  // intentional; the title signal is the source of truth while open.
  // eslint-disable-next-line solid/reactivity -- one-time prefill on open
  const [title, setTitle] = createSignal(props.session.title ?? "");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);

  const canSubmit = () => title().trim() !== "" && !saving();

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit()) return;
    setSaving(true);
    setError(null);
    try {
      await renameSession(
        props.serverId,
        props.session.id,
        title().trim(),
        createSessionService(getApiClient()),
      );
      props.onClose();
    } catch (err) {
      setError(ApiError.fromUnknown(err));
      setSaving(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        // Esc / overlay / CloseButton while saving must not orphan the
        // in-flight PATCH; the guard in onSubmit is the backstop.
        if (!open && !saving()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="rename-session-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title class="text-md font-semibold">Rename session</Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            {props.session.title || props.session.slug}
          </Dialog.Description>

          <form data-testid="rename-session-form" class="mt-5 space-y-4" onSubmit={onSubmit}>
            <label class="block">
              <span class="text-sm font-medium text-fg-secondary">Title</span>
              <input
                data-testid="rename-session-input"
                class={inputClass}
                type="text"
                value={title()}
                onInput={(event) => setTitle(event.currentTarget.value)}
              />
            </label>
            <Show when={error()}>
              <p data-testid="rename-session-error" class="text-sm text-danger">
                {errorLine(error()!)}
              </p>
            </Show>
            <div class="flex justify-end gap-3 pt-1">
              <Dialog.CloseButton
                data-testid="rename-session-cancel"
                class={actionClass}
                disabled={saving()}
              >
                Cancel
              </Dialog.CloseButton>
              <button
                data-testid="rename-session-save"
                type="submit"
                class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSubmit()}
              >
                {saving() ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default RenameSessionDialog;
