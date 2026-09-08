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

import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

export interface VirtualListOptions {
  /** Default height of an unmeasured row in px. */
  estimate?: number;
  /** Extra rows mounted above and below the visible range. */
  overscan?: number;
  /** Sticky composer height included in the native scroll range. */
  bottomInset?: () => number;
}

export interface VirtualRow {
  /** Row index into the item list. */
  index: number;
  /** Offset of the row's top edge from the content top, in px. */
  start: number;
  /** Current height of the row, in px. */
  height: number;
}

export interface VirtualAnchor {
  key: string;
  offset: number;
  fallbackTop: number;
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
  /** The sole modeled scroll boundary for this transcript. */
  maxScrollTop: () => number;
  /** Whether the current position follows the modeled transcript bottom. */
  isNearBottom: (threshold?: number) => boolean;
  /** Feed scroll events from the scroll container here. */
  onScroll: (el: HTMLDivElement) => void;
  /** Re-read viewport/scrollTop from the container (mount, resize). */
  measure: () => void;
  /** Ref callback for a row element; measures the row once laid out. The
   * key is the row's identity (from getRowKey), so heights survive the
   * caller prepending rows that shift every index. */
  measureRow: (key: string, el: HTMLElement | undefined) => void;
  /** Captures the first visible row so a prepend can preserve the reader. */
  captureAnchor: () => VirtualAnchor | undefined;
  /** Restores a captured row anchor after a prepend or height change. */
  restoreAnchor: (anchor: VirtualAnchor | undefined) => void;
  /** Discards measurements, observers, and scroll state from another session. */
  reset: () => void;
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
  const pendingMeasurements = new Map<string, number>();
  let measurementRaf = 0;
  let generation = 0;

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
    const top = Math.min(
      Math.max(scrollTop(), 0),
      Math.max(0, total + (options.bottomInset?.() ?? 0) - viewport()),
    );
    const bottom = top + Math.max(0, viewport() - (options.bottomInset?.() ?? 0));
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

  const maxScrollTop = createMemo(() =>
    Math.max(0, totalHeight() + (options.bottomInset?.() ?? 0) - viewport()),
  );

  createEffect(() => {
    const max = maxScrollTop();
    const top = scrollTop();
    const el = getScrollEl();
    if (top > max) {
      if (el !== undefined) el.scrollTop = max;
      setScrollTop(max);
      return;
    }
    if (el !== undefined && el.scrollTop > max) el.scrollTop = max;
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
      pendingMeasurements.delete(key);
      return;
    }
    const rowEl = el;
    const rowGeneration = generation;
    // Streaming rows grow while mounted (their height is unknown until the
    // next ResizeObserver pass); without one (jsdom, old WebViews) the
    // estimate stands and the overscan hides the difference.
    observers.get(key)?.disconnect();
    observers.delete(key);
    function queueMeasurement(): void {
      if (rowGeneration !== generation || !rowEl.isConnected) return;
      // Preserve subpixel heights: rounding every row accumulates a false
      // scroll range across long transcripts at non-default UI scales.
      const h = rowEl.getBoundingClientRect().height || rowEl.offsetHeight;
      if (h <= 0 || measured.get(key) === h) return;
      pendingMeasurements.set(key, h);
      if (measurementRaf !== 0) return;
      measurementRaf = requestAnimationFrame(() => {
        measurementRaf = 0;
        const anchor = captureAnchor();
        const wasBottom = isNearBottom(2);
        for (const [pendingKey, pendingHeight] of pendingMeasurements) {
          measured.set(pendingKey, pendingHeight);
        }
        pendingMeasurements.clear();
        setHeightVersion((v) => v + 1);
        // Solid applies the derived spacer before this frame completes. Both
        // paths use the virtual model, never a stale DOM scrollHeight.
        if (wasBottom) scrollTo(maxScrollTop());
        else restoreAnchor(anchor);
      });
    }
    queueMicrotask(queueMeasurement);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(queueMeasurement);
      observers.set(key, observer);
      observer.observe(rowEl);
    }
  }

  function scrollTo(top: number, behavior: ScrollBehavior = "auto"): void {
    const el = getScrollEl();
    const clamped = Math.min(Math.max(0, top), maxScrollTop());
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

  function isNearBottom(threshold = 2): boolean {
    return maxScrollTop() - scrollTop() <= threshold;
  }

  function captureAnchor(): VirtualAnchor | undefined {
    const n = count();
    if (n === 0) return undefined;
    const sums = prefixSums();
    const top = Math.min(scrollTop(), maxScrollTop());
    for (let index = 0; index < n; index++) {
      if (sums[index + 1] > top) {
        return { key: getRowKey(index), offset: top - sums[index], fallbackTop: top };
      }
    }
    return undefined;
  }

  function restoreAnchor(anchor: VirtualAnchor | undefined): void {
    if (anchor === undefined) return;
    const n = count();
    const sums = prefixSums();
    for (let index = 0; index < n; index++) {
      if (getRowKey(index) === anchor.key) {
        scrollTo(sums[index] + anchor.offset);
        return;
      }
    }
    scrollTo(anchor.fallbackTop);
  }

  function reset(): void {
    generation += 1;
    for (const observer of observers.values()) observer.disconnect();
    observers.clear();
    measured.clear();
    pendingMeasurements.clear();
    if (measurementRaf !== 0) cancelAnimationFrame(measurementRaf);
    measurementRaf = 0;
    const el = getScrollEl();
    if (el !== undefined) el.scrollTop = 0;
    setScrollTop(0);
    setViewport(el?.clientHeight ?? 0);
    setHeightVersion((v) => v + 1);
  }

  onCleanup(() => {
    generation += 1;
    for (const observer of observers.values()) observer.disconnect();
    if (measurementRaf !== 0) cancelAnimationFrame(measurementRaf);
  });

  return {
    rows,
    totalHeight,
    viewport,
    scrollTop,
    maxScrollTop,
    isNearBottom,
    onScroll,
    measure,
    measureRow,
    captureAnchor,
    restoreAnchor,
    reset,
    scrollTo,
  };
}
