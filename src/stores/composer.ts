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
const [drafts, setDrafts] = createSignal<Record<string, string>>({});

function draftKey(serverId: string, sessionId: string): string {
  return `${serverId}\u0000${sessionId}`;
}

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

/** Returns the unsent text for one server/session pair. */
export function composerDraft(serverId: string, sessionId: string): string {
  return drafts()[draftKey(serverId, sessionId)] ?? "";
}

/** Stores an unsent draft without affecting another session's composer. */
export function setComposerDraft(serverId: string, sessionId: string, text: string): void {
  const key = draftKey(serverId, sessionId);
  setDrafts((previous) => (previous[key] === text ? previous : { ...previous, [key]: text }));
}

/** Removes a draft once it has been successfully sent. */
export function clearComposerDraft(serverId: string, sessionId: string): void {
  const key = draftKey(serverId, sessionId);
  setDrafts((previous) => {
    if (!(key in previous)) return previous;
    const next = { ...previous };
    delete next[key];
    return next;
  });
}

/** Test-only reset for the in-memory composer state. */
export function resetComposerDrafts(): void {
  setDrafts({});
}
