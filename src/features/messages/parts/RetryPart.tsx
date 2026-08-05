// Retry notice (TASK-M3-04): renders a RetryPart as a system-style chip with
// a refresh icon, the attempt count and the failure reason. The 1.18.11
// schema carries no scheduling field, so the countdown accepts an optional
// `retryAt` prop (epoch ms): with it the "next attempt in Xs" label ticks
// down once per second and is cleaned up on dispose; without it the label
// stays a static "Retrying…". Rate-limit failures (429 or a message hint,
// via the shared services/errors.ts predicate) render the error in danger
// styling.

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { isRateLimitHint } from "../../../services/errors.js";
import { useT } from "../../../i18n/index.js";
import type { Part } from "../../../stores/messages.js";

export type RetryPartData = Extract<Part, { type: "retry" }>;

export interface RetryPartProps {
  part: RetryPartData;
  /** Epoch ms of the next attempt; absent until the caller can provide it. */
  retryAt?: number;
}

const TICK_MS = 1000;

/** True when the retry error is a provider/HTTP rate limit (429 or hint). */
export function isRateLimitError(error: RetryPartData["error"]): boolean {
  return isRateLimitHint(error.data.statusCode, error.data.message);
}

const RetryPart: Component<RetryPartProps> = (props) => {
  const t = useT();
  const [now, setNow] = createSignal(Date.now());

  // Live countdown clock: ticks only while `retryAt` is present; the
  // interval is cleaned up on dispose so it never outlives the part.
  createEffect(() => {
    if (props.retryAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    onCleanup(() => clearInterval(timer));
  });

  const errorMessage = createMemo(() => props.part.error.data.message.trim());
  const rateLimit = createMemo(() => isRateLimitError(props.part.error));

  const secondsLeft = (): number | undefined => {
    if (props.retryAt === undefined) return undefined;
    return Math.max(0, Math.ceil((props.retryAt - now()) / 1000));
  };

  const countdownLabel = createMemo(() => {
    const seconds = secondsLeft();
    if (seconds === undefined || seconds <= 0) return t("messages:retrying");
    return t("messages:retryCountdown", { seconds });
  });

  return (
    <div
      data-testid="retry-part"
      class="my-1 inline-flex w-fit flex-col gap-0.5 rounded-md border border-bg-sunken bg-bg-sunken/40 px-2 py-1 text-xs text-fg-secondary"
    >
      <span class="flex flex-wrap items-center gap-1.5">
        <svg
          aria-hidden
          class="h-3.5 w-3.5 shrink-0 text-fg-faint"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
          <path d="M13.5 2.5V6h-3.5" />
        </svg>
        <span data-testid="retry-attempt" class="font-medium text-fg-primary">
          {t("messages:retryAttempt", { attempt: props.part.attempt })}
        </span>
        <span data-testid="retry-countdown" class="shrink-0 text-fg-faint">
          {countdownLabel()}
        </span>
      </span>
      <Show when={errorMessage() !== ""}>
        <span
          data-testid="retry-error"
          class={`whitespace-pre-wrap break-words leading-relaxed ${
            rateLimit() ? "text-danger" : "text-fg-faint"
          }`}
          title={errorMessage()}
        >
          {errorMessage()}
        </span>
      </Show>
    </div>
  );
};

export { RetryPart };
export default RetryPart;
