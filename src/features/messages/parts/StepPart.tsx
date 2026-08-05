// Step boundary parts (TASK-M3-03): StepStartPart renders the thin divider
// that marks a step boundary (plus the short start-snapshot id when the part
// carries one); StepFinishPart renders the "Step complete" meta row with the
// finish reason, the formatted token count and the USD cost. The 1.18.11
// schema carries no title/agent/model/duration on either part, so the meta
// row is limited to what the contract provides; `formatTokens` and
// `formatUSD` are exported for the unit tests.

import { createMemo, Show } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { useT } from "../../../i18n/index.js";

export type StepStartPartData = Extract<Part, { type: "step-start" }>;
export type StepFinishPartData = Extract<Part, { type: "step-finish" }>;

export interface StepStartPartProps {
  part: StepStartPartData;
}

export interface StepFinishPartProps {
  part: StepFinishPartData;
}

/** Compact token counts: "999", "12.3k", "1.23M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n < 1000) return `${Math.max(0, Math.round(n))}`;
  if (n < 1_000_000) {
    const k = Math.round((n / 1000) * 10) / 10;
    return `${k}k`;
  }
  const m = Math.round((n / 1_000_000) * 100) / 100;
  return `${m}M`;
}

/** USD amount with trailing zeros stripped: "$0.42", "$0.012", "$12". */
export function formatUSD(cost: number): string {
  if (!Number.isFinite(cost)) return "$0";
  return `$${cost.toFixed(3).replace(/\.?0+$/, "")}`;
}

const StepStartPart: Component<StepStartPartProps> = (props) => {
  const t = useT();
  const shortId = createMemo(() => props.part.snapshot?.slice(0, 12));

  return (
    <div
      data-testid="step-start-part"
      class="my-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-fg-faint"
    >
      <span class="shrink-0">{t("messages:step")}</span>
      <span aria-hidden class="h-px flex-1 rounded-full bg-bg-sunken" />
      <Show when={shortId() !== undefined}>
        <span
          data-testid="step-start-snapshot"
          class="shrink-0 font-code text-[10px] normal-case tracking-normal"
          title={t("messages:snapshotAtStepStart")}
        >
          {shortId()}
        </span>
      </Show>
    </div>
  );
};

const StepFinishPart: Component<StepFinishPartProps> = (props) => {
  const t = useT();
  // The schema's total is optional; without it the input + output counts
  // give the closest estimate of the step's usage.
  const tokens = createMemo(
    () => props.part.tokens.total ?? props.part.tokens.input + props.part.tokens.output,
  );
  const reason = createMemo(() => {
    const value = props.part.reason;
    return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
  });

  return (
    <div
      data-testid="step-finish-part"
      class="my-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-bg-sunken bg-bg-sunken/40 px-2 py-1 text-xs text-fg-secondary"
    >
      <span class="font-medium text-fg-primary">{t("messages:stepComplete")}</span>
      <span data-testid="step-finish-reason" class="text-fg-faint">
        {reason()}
      </span>
      <span data-testid="step-finish-tokens">
        {formatTokens(tokens())} {t("messages:tokenUnit")}
      </span>
      <span data-testid="step-finish-cost" class="ml-auto shrink-0 font-code">
        {formatUSD(props.part.cost)}
      </span>
    </div>
  );
};

export { StepStartPart, StepFinishPart };
