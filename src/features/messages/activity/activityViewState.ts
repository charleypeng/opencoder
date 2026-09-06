// Activity Trace view state (CHAT-TRACE-02): keeps disclosure choices
// outside the row component so virtualized/unmounted messages can restore
// the user's choice without persisting transient UI state.

const expandedByTrace = new Map<string, boolean>();
const expandedEntriesByTrace = new Map<string, Set<string>>();

export function readActivityExpanded(traceKey: string, fallback = false): boolean {
  return expandedByTrace.get(traceKey) ?? fallback;
}

/** True once the user made an explicit choice, so completion auto-collapse
 *  must leave the fold alone (PROCESS-REF-01). */
export function hasActivityExpandedChoice(traceKey: string): boolean {
  return expandedByTrace.has(traceKey);
}

export function writeActivityExpanded(traceKey: string, expanded: boolean): void {
  expandedByTrace.set(traceKey, expanded);
}

export function readActivityEntryExpanded(traceKey: string, entryId: string): boolean {
  return expandedEntriesByTrace.get(traceKey)?.has(entryId) ?? false;
}

export function writeActivityEntryExpanded(
  traceKey: string,
  entryId: string,
  expanded: boolean,
): void {
  const entries = new Set(expandedEntriesByTrace.get(traceKey));
  if (expanded) entries.add(entryId);
  else entries.delete(entryId);
  if (entries.size === 0) expandedEntriesByTrace.delete(traceKey);
  else expandedEntriesByTrace.set(traceKey, entries);
}

export function clearActivityViewState(): void {
  expandedByTrace.clear();
  expandedEntriesByTrace.clear();
}
