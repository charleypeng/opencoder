// Dismissable classified connection-error banner (TASK-M1-09): renders the
// errorTitle/errorDetail pair of an ApiError until dismissed. Used by
// ServerHome today; the workspace shell picks it up in M2.

import { Show } from "solid-js";
import { ApiError, errorDetail, errorTitle } from "../services/errors";

export interface ErrorBannerProps {
  /** The error to show; null renders nothing. */
  error: ApiError | null;
  onDismiss: () => void;
}

function ErrorBanner(props: ErrorBannerProps) {
  const title = () => (props.error ? errorTitle(props.error) : "");
  const detail = () => (props.error ? errorDetail(props.error) : "");

  return (
    <Show when={props.error}>
      <div
        role="alert"
        data-testid="error-banner"
        class="mb-4 flex items-start justify-between gap-3 rounded-md border border-danger/40 bg-danger/10 px-4 py-3"
      >
        <div class="min-w-0">
          <p data-testid="error-banner-title" class="text-sm font-semibold text-danger">
            {title()}
          </p>
          <Show when={detail() !== title()}>
            <p data-testid="error-banner-detail" class="mt-0.5 text-xs text-danger/80">
              {detail()}
            </p>
          </Show>
        </div>
        <button
          type="button"
          data-testid="error-banner-dismiss"
          aria-label="Dismiss"
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
