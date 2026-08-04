// Composer prefill store (TASK-M7-10): a single pending text that the
// Android share receive wires into the composer. The PromptBox consumes
// it exactly once (stores/composer.ts + features/sessions/PromptBox.tsx),
// so a shared text that arrives while no chat page is mounted survives
// until a composer exists — the pending slot keeps only the latest text.

import { createSignal } from "solid-js";

export interface ComposerPrefill {
  text: string;
}

const [pending, setPending] = createSignal<ComposerPrefill | null>(null);

/** The pending prefill (null when none); read by the composer. */
export function composerPrefill(): ComposerPrefill | null {
  return pending();
}

/** Queues a shared text for the composer (blank input is ignored). */
export function prefillComposer(text: string): void {
  const trimmed = text.trim();
  if (trimmed === "") return;
  setPending({ text: trimmed });
}

/** Consumes the pending prefill once the composer has applied it. */
export function consumeComposerPrefill(): void {
  setPending(null);
}
