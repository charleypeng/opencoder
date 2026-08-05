// Toast host (TASK-M6-06): renders the toast stack from the toasts store —
// a fixed overlay in the top-right corner. Auto-dismissal lives in the
// store (3s per entry); this component only renders + manual dismiss.

import { For } from "solid-js";
import type { Component } from "solid-js";
import { dismissToast, toasts } from "../stores/toasts.js";
import { useT } from "../i18n/index.js";

const kindIcon: Record<string, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
};

const kindClass: Record<string, string> = {
  success: "border-success/40 text-success",
  error: "border-danger/40 text-danger",
  info: "border-bg-sunken text-fg-secondary",
};

export const Toasts: Component = () => {
  const t = useT();
  return (
    <div
      data-testid="toast-host"
      aria-live="polite"
      class="pointer-events-none fixed right-4 top-4 z-[60] flex w-72 flex-col gap-2"
    >
      <For each={toasts}>
        {(toast) => (
          <div
            data-testid="toast"
            data-kind={toast.kind}
            class={`glass pointer-events-auto flex items-start gap-2 rounded-md border p-3 text-sm shadow-lg ${kindClass[toast.kind]}`}
          >
            <span class="shrink-0 leading-none">{kindIcon[toast.kind]}</span>
            <span class="min-w-0 flex-1 break-words text-fg-primary">{toast.message}</span>
            <button
              type="button"
              data-testid="toast-dismiss"
              aria-label={t("notifications:dismiss")}
              class="shrink-0 rounded p-0.5 leading-none text-fg-faint hover:text-fg-primary"
              onClick={() => dismissToast(toast.id)}
            >
              ×
            </button>
          </div>
        )}
      </For>
    </div>
  );
};

export default Toasts;
