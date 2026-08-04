// Session error banner (TASK-M2-10): surfaces `session.error` events for the
// composed session as a dismissable banner between the message list and the
// composer. The banner is derived from the store's per-session status entry
// (type "error" with an optional message), so it auto-clears as soon as any
// status event (idle/busy) replaces the error — no manual syncing. The title
// comes from the classified copy in services/errors.ts (rate-limit and
// network messages get their own titles); the raw message is behind a
// "Show details" expander. When the per-server prompt history holds a last
// prompt, a Retry action re-sends it through the shared sendPrompt pipeline
// (a failed re-send re-arms the banner with the classified error; a
// successful one dismisses it).

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { ApiError, errorDetail, errorTitle } from "../../services/errors.js";
import { dismissSessionError, getServerSessionState } from "../../stores/session.js";
import { untrackPendingLocalMessage } from "../../stores/messages.js";
import { getLastPrompt } from "./promptHistory.js";
import { sendPrompt } from "./sendPrompt.js";

export interface SessionErrorBannerProps {
  /** The server whose session is composed in. */
  serverId: string;
  /** The active session the error belongs to. */
  sessionId: string;
}

const SessionErrorBanner: Component<SessionErrorBannerProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [retrying, setRetrying] = createSignal(false);
  // The classified error of a failed retry: kept local so the status/code
  // classification survives (the store entry only carries a message).
  const [retryError, setRetryError] = createSignal<ApiError | null>(null);

  const entry = createMemo(() => getServerSessionState(props.serverId).statuses[props.sessionId]);

  // A failed retry error wins over the store entry (same session); the
  // synthetic store entry is shaped like an ApiError's payload fields so
  // the classified title/detail copy applies (message-only classification).
  const err = createMemo(() => {
    const status = entry();
    if (status?.type !== "error") return null;
    const local = retryError();
    if (local !== null) return local;
    return new ApiError(undefined, "session", status.message ?? "", true);
  });
  const title = createMemo(() => (err() === null ? "" : errorTitle(err() as ApiError)));
  const detail = createMemo(() => (err() === null ? "" : errorDetail(err() as ApiError)));
  const hasDetail = createMemo(() => detail() !== title());
  const lastPrompt = createMemo(() => getLastPrompt(props.serverId));

  // A send started from here must not reconcile against a stale pending
  // marker once this banner unmounts (same pattern as PromptBox).
  createEffect(() => {
    const sessionId = props.sessionId;
    onCleanup(() => untrackPendingLocalMessage(props.serverId, sessionId));
  });

  // Collapse the detail section again when the banner re-arms.
  createEffect(() => {
    if (err() === null) {
      setExpanded(false);
      setRetryError(null);
    }
  });

  function dismiss(): void {
    dismissSessionError(props.serverId, props.sessionId);
  }

  async function retry(): Promise<void> {
    const prompt = lastPrompt();
    if (prompt === undefined || retrying()) return;
    setRetrying(true);
    try {
      const sendErr = await sendPrompt(props.serverId, props.sessionId, prompt);
      if (sendErr === null) {
        dismiss();
      } else {
        setRetryError(sendErr);
      }
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Show when={err() !== null}>
      <div
        role="alert"
        data-testid="session-error-banner"
        class="mx-4 mt-3 flex shrink-0 items-start justify-between gap-3 rounded-md border border-danger/40 bg-danger/10 px-4 py-3"
      >
        <div class="min-w-0">
          <p data-testid="session-error-title" class="text-sm font-semibold text-danger">
            {title()}
          </p>
          <Show when={hasDetail()}>
            <button
              type="button"
              data-testid="session-error-expand"
              class="mt-1 text-xs text-danger/80 underline outline-none hover:text-danger"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded() ? "Hide details" : "Show details"}
            </button>
            <Show when={expanded()}>
              <pre
                data-testid="session-error-detail"
                class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-danger/5 px-2 py-1.5 text-xs leading-5 text-danger/80"
              >
                {detail()}
              </pre>
            </Show>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Show when={lastPrompt() !== undefined}>
            <button
              type="button"
              data-testid="session-error-retry"
              disabled={retrying()}
              onClick={() => void retry()}
              class="rounded-md border border-danger/40 px-2.5 py-1 text-xs text-danger outline-none hover:bg-danger/10 focus:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Retry
            </button>
          </Show>
          <button
            type="button"
            data-testid="session-error-dismiss"
            aria-label="Dismiss"
            class="shrink-0 rounded-md px-1.5 text-sm text-danger/70 outline-none hover:text-danger"
            onClick={dismiss}
          >
            ×
          </button>
        </div>
      </div>
    </Show>
  );
};

export default SessionErrorBanner;
