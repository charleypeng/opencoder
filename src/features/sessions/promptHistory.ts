// Per-server prompt history (TASK-M2-08): in-memory ring of sent prompts,
// most recent first, capped at 20 entries. The ↑-on-empty recall cycles
// through this list via an index; the list is purely session-scoped memory
// and deliberately does not persist (no cross-launch expectations).

const HISTORY_CAP = 20;

const history = new Map<string, string[]>();

/** All stored prompts for a server, most recent first (never mutated). */
export function readPrompts(serverId: string): string[] {
  return history.get(serverId) ?? [];
}

/** Records a sent prompt: dedupes repeats and caps the list. */
export function pushPrompt(serverId: string, text: string): string[] {
  const current = history.get(serverId) ?? [];
  const next = [text, ...current.filter((entry) => entry !== text)].slice(0, HISTORY_CAP);
  history.set(serverId, next);
  return next;
}

/** Prompt at a browse index (0 = most recent); undefined past the end. */
export function promptAt(serverId: string, index: number): string | undefined {
  return readPrompts(serverId)[index];
}

/** Most recently sent prompt for a server; undefined when nothing was sent. */
export function getLastPrompt(serverId: string): string | undefined {
  return readPrompts(serverId)[0];
}

/** Drops a server's history (e.g. when the server context is torn down). */
export function clearPrompts(serverId: string): void {
  history.delete(serverId);
}
