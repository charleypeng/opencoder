// Init dialog (TASK-M6-06): generate an AGENTS.md for the project through
// POST /session/{id}/init. The 1.18.11 contract requires the provider/
// model pair AND the messageID of the analysis request the file is
// generated from, so the dialog presets the session's most recent user
// message and — when none exists — disables confirm with a note guiding
// the user to send an analysis prompt first. A compact model select
// (connected providers only, session model preselected) picks the pair;
// success fires a success toast and closes, failure stays inline, and the
// dialog locks with a "Generating…" hint while in flight.

import { createMemo, createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { getApiClient } from "../../services/client";
import { ApiError } from "../../services/errors";
import { useErrorCopy } from "../../components/errorCopy";
import { useT } from "../../i18n";
import type { Session } from "../../services/session";
import { createSessionService } from "../../services/session";
import { getServerMessages } from "../../stores/messages.js";
import { ModelSelect } from "../models/ModelSelect.js";
import type { ModelRef } from "../../stores/models.js";
import { createToast } from "../../stores/toasts.js";

export interface InitDialogProps {
  /** The server whose session is being initialized. */
  serverId: string;
  /** The session the AGENTS.md is generated from (always present). */
  session: Session;
  onClose: () => void;
}

const actionClass =
  "rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm " +
  "text-fg-secondary hover:text-fg-primary";

const primaryClass =
  "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/** The most recent user message of the session, or undefined. */
export function latestUserMessage(
  serverId: string,
  sessionId: string,
): { id: string; created: number } | undefined {
  const infos = Object.values(getServerMessages(serverId)[sessionId]?.infos ?? {});
  let latest: { id: string; created: number } | undefined;
  for (const info of infos) {
    if (info.role !== "user") continue;
    const created = info.time?.created ?? 0;
    if (latest === undefined || created >= latest.created) {
      latest = { id: info.id, created };
    }
  }
  return latest;
}

const InitDialog: Component<InitDialogProps> = (props) => {
  const t = useT();
  const { line: errorLine } = useErrorCopy();
  const [selection, setSelection] = createSignal<ModelRef | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);
  const userMessage = createMemo(() => latestUserMessage(props.serverId, props.session.id));

  async function handleConfirm() {
    if (busy()) return;
    const ref = selection();
    const message = userMessage();
    if (ref === null || message === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await createSessionService(getApiClient()).init(props.session.id, {
        providerID: ref.providerID,
        modelID: ref.modelID,
        messageID: message.id,
      });
      createToast(t("sessions:agentsGeneratedToast"), "success");
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
        // Esc / overlay / CloseButton while an init round-trip is in
        // flight must not orphan it; the busy guard is the backstop.
        if (!open && !busy()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="init-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title class="text-md font-semibold">{t("sessions:generateAgents")}</Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            {props.session.title || props.session.slug}
          </Dialog.Description>

          <div class="mt-5 space-y-4">
            <Show
              when={userMessage()}
              fallback={
                <div data-testid="init-guidance" class="space-y-2">
                  <p class="text-sm text-fg-secondary">{t("sessions:initHint")}</p>
                  <p data-testid="init-message-preset" class="text-xs text-fg-faint">
                    {t("sessions:initNoMessage")}
                  </p>
                </div>
              }
            >
              <p data-testid="init-message-preset" class="text-xs text-fg-secondary">
                {t("sessions:initFromMessage", { id: userMessage()!.id })}
              </p>
            </Show>
            <ModelSelect
              serverId={props.serverId}
              session={props.session}
              value={selection()}
              onChange={setSelection}
            />
            <Show when={error()}>
              <p data-testid="init-error" class="text-sm text-danger">
                {errorLine(error()!)}
              </p>
            </Show>
            <div class="flex justify-end gap-3 pt-1">
              <Dialog.CloseButton data-testid="init-close" class={actionClass} disabled={busy()}>
                {t("common:cancel")}
              </Dialog.CloseButton>
              <button
                type="button"
                data-testid="init-confirm"
                class={primaryClass}
                disabled={busy() || selection() === null || userMessage() === undefined}
                onClick={handleConfirm}
              >
                {busy() ? t("messages:generating") : t("sessions:generateAgents")}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default InitDialog;
