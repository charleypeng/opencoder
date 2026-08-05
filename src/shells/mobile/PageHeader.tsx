// Mobile page header (TASK-M7-03): the shared header for mobile pages — an
// optional back button (chevron + label) on the left and the page title.
// Back routes through the navigation store's pop; pages on a tab ROOT pass
// their own exit/back target instead (back() is a no-op there).

import { Show } from "solid-js";
import type { Component } from "solid-js";
import { useT } from "../../i18n/index.js";

export interface PageHeaderProps {
  title: string;
  /** Shown as a leading back/exit button; hidden when omitted. */
  onBack?: () => void;
  /** Back button label; defaults to "Back". */
  backLabel?: string;
}

export const PageHeader: Component<PageHeaderProps> = (props) => {
  const t = useT();
  return (
    <header
      data-testid="mobile-page-header"
      class="flex h-11 shrink-0 items-center gap-2 border-b border-bg-sunken px-2"
    >
      <Show when={props.onBack}>
        <button
          type="button"
          data-testid="page-back"
          aria-label={props.backLabel ?? t("mobile:back")}
          class="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary"
          onClick={() => props.onBack?.()}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          {props.backLabel ?? t("mobile:back")}
        </button>
      </Show>
      <h2 data-testid="mobile-page-title" class="min-w-0 truncate text-sm font-semibold">
        {props.title}
      </h2>
    </header>
  );
};
