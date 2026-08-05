// Dismissable classified connection-error banner (TASK-M1-09): renders the
// classified title of an ApiError (via the i18n error keys, TASK-M9-02)
// with the raw server message as the optional detail, until dismissed.
// Used by ServerHome today; the workspace shell picks it up in M2.

import { Show } from "solid-js";
import { ApiError, errorDetailMessage } from "../services/errors";
import { useErrorCopy } from "./errorCopy";
import { useT } from "../i18n";

export interface ErrorBannerProps {
  /** The error to show; null renders nothing. */
  error: ApiError | null;
  onDismiss: () => void;
}

function ErrorBanner(props: ErrorBannerProps) {
  const { title } = useErrorCopy();
  const t = useT();
  // The raw server message is display-only; the translated title stands in
  // when there is no message.
  const titleText = () => (props.error ? title(props.error) : "");
  const detail = () => (props.error ? errorDetailMessage(props.error) : null);

  return (
    <Show when={props.error}>
      <div
        role="alert"
        data-testid="error-banner"
        class="mb-4 flex items-start justify-between gap-3 rounded-md border border-danger/40 bg-danger/10 px-4 py-3"
      >
        <div class="min-w-0">
          <p data-testid="error-banner-title" class="text-sm font-semibold text-danger">
            {titleText()}
          </p>
          <Show when={detail() !== null && detail() !== titleText()}>
            <p data-testid="error-banner-detail" class="mt-0.5 text-xs text-danger/80">
              {detail()}
            </p>
          </Show>
        </div>
        <button
          type="button"
          data-testid="error-banner-dismiss"
          aria-label={t("common:dismiss")}
          class="shrink-0 rounded-md px-1.5 text-sm text-danger/70 hover:text-danger"
          onClick={() => props.onDismiss()}
        >
          ×
        </button>
      </div>
    </Show>
  );
}

export default ErrorBanner;
