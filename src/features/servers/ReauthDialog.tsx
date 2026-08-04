// Credential re-entry dialog (TASK-M1-09): opens when a saved server answers
// with 401 so the user can retry with new credentials. The new credentials
// stay in memory: the dialog only submits them to the parent, which verifies
// them with a probe BEFORE persisting (update_server) — the parent's
// `onSubmit` promise resolves only after that verification succeeded. A
// rejection keeps the dialog open with the error inline.

import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { ApiError, errorDetail, errorTitle } from "../../services/errors";
import type { AuthCredentials } from "../../services/servers";
import type { ServerEntry } from "../../services/servers";

export interface ReauthDialogProps {
  /** The server being re-authenticated; null closes the dialog. */
  server: ServerEntry | null;
  /** The 401 that triggered the flow, shown as context. */
  reason: ApiError | null;
  /**
   * Verifies the credentials (probe) and persists them on success. Must
   * reject with an ApiError when verification fails.
   */
  onSubmit: (credentials: AuthCredentials) => Promise<void>;
  onCancel: () => void;
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

const ReauthDialog: Component<ReauthDialogProps> = (props) => {
  // Mounted per server (keyed in ServerHome), so one-time prefill is
  // intentional; the password is never prefilled.
  // eslint-disable-next-line solid/reactivity -- one-time prefill on open
  const [username, setUsername] = createSignal(props.server?.username ?? "");
  const [password, setPassword] = createSignal("");
  const [verifying, setVerifying] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);

  const canSubmit = () => password().length > 0 && !verifying();

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit()) return;
    setVerifying(true);
    setError(null);
    try {
      await props.onSubmit({
        username: username().trim() || undefined,
        password: password(),
      });
    } catch (err) {
      setError(ApiError.fromUnknown(err));
      setVerifying(false);
    }
  }

  return (
    <Dialog.Root
      open={props.server !== null}
      onOpenChange={(open) => {
        // Block Esc / overlay dismiss while verifying so a closed dialog
        // cannot orphan an in-flight retry; the guard in the parent's
        // onSubmit continuation is the authoritative backstop.
        if (!open && !verifying()) props.onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="reauth-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title class="text-md font-semibold">Authentication required</Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            <Show when={props.reason} fallback={props.server?.name}>
              {(reason) => (
                <span data-testid="reauth-reason">
                  {props.server?.name} — {errorTitle(reason())}
                  <Show when={errorDetail(reason()) !== errorTitle(reason())}>
                    <span> ({errorDetail(reason())})</span>
                  </Show>
                </span>
              )}
            </Show>
          </Dialog.Description>

          <form class="mt-5 space-y-4" onSubmit={onSubmit}>
            <label class="block">
              <span class="text-sm font-medium text-fg-secondary">Username (optional)</span>
              <input
                data-testid="reauth-username"
                class={inputClass}
                type="text"
                autocomplete="username"
                placeholder="admin"
                value={username()}
                onInput={(event) => setUsername(event.currentTarget.value)}
              />
            </label>
            <label class="block">
              <span class="text-sm font-medium text-fg-secondary">Password</span>
              <input
                data-testid="reauth-password"
                class={inputClass}
                type="password"
                autocomplete="current-password"
                placeholder="••••••••"
                value={password()}
                onInput={(event) => setPassword(event.currentTarget.value)}
              />
            </label>
            <Show when={error()}>
              <p data-testid="reauth-error" class="text-sm text-danger">
                {errorLine(error()!)}
              </p>
            </Show>
            <div class="flex justify-end gap-3 pt-1">
              <Dialog.CloseButton
                data-testid="reauth-cancel"
                class={actionClass}
                disabled={verifying()}
              >
                Cancel
              </Dialog.CloseButton>
              <button
                data-testid="reauth-save"
                type="submit"
                class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSubmit()}
              >
                {verifying() ? "Verifying…" : "Save & Retry"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default ReauthDialog;
