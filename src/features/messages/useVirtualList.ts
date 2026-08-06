// Hand-written virtual list (TASK-M2-09): renders only the message rows that
// intersect the scroll viewport (plus an overscan margin), so a transcript
// with hundreds of messages mounts a constant handful of bubbles. Row
// positions come from prefix sums over per-row heights: rows default to the
// `estimate` height and are re-measured from the real DOM once mounted
// (offsetHeight on mount, ResizeObserver afterwards for growing streaming
// rows). In environments without layout or ResizeObserver (jsdom tests) the
// estimates are used unchanged, which keeps the tests deterministic.
//
// Measured heights are keyed by ROW IDENTITY (the getRowKey accessor), not
// by position: when the caller PREPENDS rows (history pagination, M3-05),
// the new rows start at the estimate while the rows that shift down keep
// their measured heights, so the delta in totalHeight is exactly the height
// of the inserted rows and the scroll re-anchor never jumps. An index-keyed
// cache would instead attribute stale heights to the new indices, making
// the delta hundreds of px off in real browsers.
//
// The hook owns the scroll position as a signal (scroll events, programmatic
// scrollTo and follow-at-bottom all go through it), so the visible range
// always matches where the content actually is.

import { createMemo, createSignal } from "solid-js";

export interface VirtualListOptions {
  /** Default height of an unmeasured row in px. */
  estimate?: number;
  /** Extra rows mounted above and below the visible range. */
  overscan?: number;
}

export interface VirtualRow {
  /** Row index into the item list. */
  index: number;
  /** Offset of the row's top edge from the content top, in px. */
  start: number;
  /** Current height of the row, in px. */
  height: number;
}

export interface VirtualList {
  /** Mounted rows, sorted by index. */
  rows: () => VirtualRow[];
  /** Sum of all row heights (the content box height). */
  totalHeight: () => number;
  /** Height of the scroll viewport in px (0 until measured). */
  viewport: () => number;
  /** Current scroll offset in px. */
  scrollTop: () => number;
  /** Feed scroll events from the scroll container here. */
  onScroll: (el: HTMLDivElement) => void;
  /** Re-read viewport/scrollTop from the container (mount, resize). */
  measure: () => void;
  /** Ref callback for a row element; measures the row once laid out. The
   * key is the row's identity (from getRowKey), so heights survive the
   * caller prepending rows that shift every index. */
  measureRow: (key: string, el: HTMLElement | undefined) => void;
  /** Programmatic scroll (keeps the internal position in sync). */
  scrollTo: (top: number, behavior?: ScrollBehavior) => void;
}

export function createVirtualList(
  getScrollEl: () => HTMLDivElement | undefined,
  count: () => number,
  /** Maps a row position to the row's identity (message id); measured
   * heights are cached per identity so index shifts never misattribute
   * a measurement to a different row. */
  getRowKey: (index: number) => string,
  options: VirtualListOptions = {},
): VirtualList {
  const estimate = options.estimate ?? 96;
  const overscan = options.overscan ?? 6;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewport, setViewport] = createSignal(0);
  // Bumped whenever a measurement lands so rows/totalHeight re-derive.
  const [heightVersion, setHeightVersion] = createSignal(0);
  // Measured heights keyed by row identity (see createVirtualList doc).
  const measured = new Map<string, number>();
  // Row observers keyed by row identity; replaced when a row is re-created,
  // so the set stays bounded by the number of distinct rows ever mounted.
  const observers = new Map<string, ResizeObserver>();

  function rowHeight(index: number): number {
    return measured.get(getRowKey(index)) ?? estimate;
  }

  /** Height of every row, prefix-summed (sums[i] = height of rows 0..i-1). */
  function prefixSums(): number[] {
    const n = count();
    const sums = new Array<number>(n + 1);
    sums[0] = 0;
    for (let i = 0; i < n; i++) sums[i + 1] = sums[i] + rowHeight(i);
    return sums;
  }

  const rows = createMemo<VirtualRow[]>(() => {
    const n = count();
    heightVersion();
    if (n === 0) return [];
    const sums = prefixSums();
    const total = sums[n];
    const top = Math.min(Math.max(scrollTop(), 0), Math.max(0, total - viewport()));
    const bottom = top + viewport();
    // Binary search: first row whose bottom edge is past the viewport top.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sums[mid + 1] <= top) lo = mid + 1;
      else hi = mid;
    }
    let last = lo;
    while (last + 1 < n && sums[last + 2] <= bottom) last++;
    last = Math.min(n - 1, last + overscan);
    const first = Math.max(0, lo - overscan);
    const out: VirtualRow[] = [];
    for (let i = first; i <= last; i++) {
      out.push({ index: i, start: sums[i], height: rowHeight(i) });
    }
    return out;
  });

  const totalHeight = createMemo(() => {
    const n = count();
    heightVersion();
    if (n === 0) return 0;
    return prefixSums()[n];
  });

  function measure(): void {
    const el = getScrollEl();
    if (el === undefined) return;
    const vp = el.clientHeight;
    if (vp !== viewport()) setViewport(vp);
    const top = el.scrollTop;
    if (top !== scrollTop()) setScrollTop(top);
  }

  function onScroll(el: HTMLDivElement): void {
    if (el.scrollTop !== scrollTop()) setScrollTop(el.scrollTop);
    measure();
  }

  function measureRow(key: string, el: HTMLElement | undefined): void {
    if (el === undefined) {
      // Row unmounted: release the observer so the map doesn't retain a
      // disconnected observer and a detached DOM element per row identity.
      observers.get(key)?.disconnect();
      observers.delete(key);
      return;
    }
    const rowEl = el;
    // Streaming rows grow while mounted (their height is unknown until the
    // next ResizeObserver pass); without one (jsdom, old WebViews) the
    // estimate stands and the overscan hides the difference.
    observers.get(key)?.disconnect();
    observers.delete(key);
    function apply(): void {
      if (!rowEl.isConnected) return;
      const h = rowEl.offsetHeight;
      if (h > 0 && measured.get(key) !== h) {
        measured.set(key, h);
        setHeightVersion((v) => v + 1);
      }
    }
    queueMicrotask(apply);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(apply);
      observers.set(key, observer);
      observer.observe(rowEl);
    }
  }

  function scrollTo(top: number, behavior: ScrollBehavior = "auto"): void {
    const el = getScrollEl();
    const clamped = Math.max(0, top);
    if (el === undefined) {
      setScrollTop(clamped);
      return;
    }
    try {
      el.scrollTo({ top: clamped, behavior });
    } catch {
      el.scrollTop = clamped;
    }
    // Sync the signal from the position the browser ACTUALLY applied: when
    // layout has not settled, the browser clamps to a stale scrollHeight,
    // and an optimistic signal would render rows for a position the DOM
    // never reached (blank viewport / flicker). Smooth scrolling streams
    // scroll events that keep the signal in sync on their own.
    if (behavior !== "smooth") setScrollTop(el.scrollTop);
  }

  return {
    rows,
    totalHeight,
    viewport,
    scrollTop,
    onScroll,
    measure,
    measureRow,
    scrollTo,
  };
}
