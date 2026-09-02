// Activity Trace view state (CHAT-TRACE-02): keeps disclosure choices
// outside the row component so virtualized/unmounted messages can restore
// the user's choice without persisting transient UI state.

const expandedByTrace = new Map<string, boolean>();

export function readActivityExpanded(traceKey: string): boolean {
  return expandedByTrace.get(traceKey) ?? false;
}

export function writeActivityExpanded(traceKey: string, expanded: boolean): void {
  expandedByTrace.set(traceKey, expanded);
}

export function clearActivityViewState(): void {
  expandedByTrace.clear();
}
