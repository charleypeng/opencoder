// Mobile gesture hooks (TASK-M7-06): swipe-to-reveal list rows, long-press,
// pull-to-refresh and edge-swipe-back. Every hook follows the same
// discipline so the gestures never fight the scroll container:
//
// - DIRECTION LOCK: a gesture is undecided until it moves ~10px; the
//   dominant axis then locks — horizontal means the gesture owns the
//   pointer (and must win over the scroll), vertical means the scroll
//   container owns it (the gesture abandons). Rows keep `touch-action:
//   pan-y` so the browser handles native vertical scrolling and hands
//   horizontal pans to the hooks.
// - Window-level move/up/cancel listeners while a gesture is active (the
//   Sheet pattern), torn down on up/cancel AND on unmount.
// - pointercancel (the browser stole the gesture — scroll steal, system
//   back, double-tap zoom) settles to the current committed state without
//   firing the action (the M7-05 review note): a swipe row snaps to the
//   nearest state, pull-to-refresh aborts, long-press/edge-swipe cancel.
// - A post-gesture click guard: any pointer gesture that moved past the
//   slop (or a tap that closed a revealed row) must not activate what is
//   under the finger — a capture-phase, self-removing click swallow on the
//   gesture's element (the Sheet click-guard pattern).

import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";

/** Movement (px) before a gesture commits to an axis. */
export const GESTURE_SLOP_PX = 10;
/** How far a row translates to reveal its actions (px). */
export const SWIPE_REVEAL_PX = 80;
/** A drag must pass this (px) to commit the reveal instead of snapping back. */
export const SWIPE_COMMIT_PX = 40;
/** Overshoot allowed past the reveal while dragging (px). */
export const SWIPE_OVERSHOOT_PX = 24;
/** Left-edge zone (px) that owns the right-swipe back gesture. */
export const EDGE_ZONE_PX = 24;
/** A rightward edge drag must reach this (px) to pop. */
export const EDGE_COMMIT_PX = 40;
/** Long-press movement slop: drifting further cancels the hold (px). */
export const LONG_PRESS_SLOP_PX = 10;
/** Default long-press hold time (ms). */
export const LONG_PRESS_MS = 500;
/** Post-gesture click guard lifetime (ms). */
export const CLICK_GUARD_MS = 500;

// --- shared click guard ---------------------------------------------------

/** One-shot capture click swallow on `element`: after a gesture the click
 *  that follows the pointer release must not activate what is under the
 *  finger (a swiped row, a long-pressed bubble). Self-removing on the
 *  first click and after a timeout, so a stray later tap is never lost. */
function armClickGuard(
  element: HTMLElement | undefined,
  state: {
    stop: ((event: Event) => void) | undefined;
    timer: number | undefined;
  },
): void {
  disarmClickGuard(element, state);
  const stop = (event: Event): void => {
    event.stopPropagation();
    event.preventDefault();
    disarmClickGuard(element, state);
  };
  state.stop = stop;
  state.timer = window.setTimeout(() => disarmClickGuard(element, state), CLICK_GUARD_MS);
  element?.addEventListener("click", stop, true);
}

function disarmClickGuard(
  element: HTMLElement | undefined,
  state: {
    stop: ((event: Event) => void) | undefined;
    timer: number | undefined;
  },
): void {
  if (state.stop !== undefined && element !== undefined) {
    element.removeEventListener("click", state.stop, true);
  }
  state.stop = undefined;
  if (state.timer !== undefined) {
    window.clearTimeout(state.timer);
    state.timer = undefined;
  }
}

// --- swipe-to-reveal rows --------------------------------------------------

export interface SwipeActions {
  /** Spread on the swipeable (foreground) row element. */
  handlers: {
    onPointerDown: (event: PointerEvent) => void;
    onPointerUp: (event: PointerEvent) => void;
    onPointerCancel: (event: PointerEvent) => void;
  };
  /** Current translateX in px (negative while revealed). */
  translateX: Accessor<number>;
  /** True while the finger is dragging (CSS transitions must be off). */
  dragging: Accessor<boolean>;
  /** True once the row is committed open. */
  revealed: Accessor<boolean>;
  /** Programmatic close (the parent keeps one row open at a time). */
  close: () => void;
}

export interface SwipeActionsOptions {
  /** Reveal width in px — must match the actions strip width. */
  revealWidth?: number;
  /** Drag distance (px) that commits the reveal. */
  commitThreshold?: number;
  /** Movement (px) before the direction locks. */
  lockSlop?: number;
}

/** Horizontal drag-to-reveal for list rows: leftward drags translate the
 *  row over a fixed actions strip; releasing past the commit threshold
 *  keeps it open, below it snaps back. Vertical drags abandon immediately
 *  (the scroll container owns the axis). A plain tap on a revealed row
 *  closes it and swallows the click, so it never navigates. */
export function useSwipeActions(options: SwipeActionsOptions = {}): SwipeActions {
  const revealWidth = options.revealWidth ?? SWIPE_REVEAL_PX;
  const commitThreshold = options.commitThreshold ?? SWIPE_COMMIT_PX;
  const lockSlop = options.lockSlop ?? GESTURE_SLOP_PX;

  const [translateX, setTranslateX] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  const [revealed, setRevealed] = createSignal(false);

  const guard = {
    stop: undefined as ((event: Event) => void) | undefined,
    timer: undefined as number | undefined,
  };

  let rowEl: HTMLElement | undefined;
  let startX = 0;
  let startY = 0;
  let startTranslate = 0;
  let locked: "none" | "horizontal" | "vertical" = "none";

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    rowEl = event.currentTarget as HTMLElement;
    startX = event.clientX;
    startY = event.clientY;
    startTranslate = revealed() ? -revealWidth : 0;
    locked = "none";
    setDragging(true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  function onPointerMove(event: PointerEvent): void {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (locked === "none") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < lockSlop) return;
      locked = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (locked === "vertical") {
        // The scroll owns the vertical axis: abandon the swipe. A revealed
        // row closes — the user is moving on, not acting — and the click
        // after a mouse drag is swallowed.
        if (revealed()) {
          setRevealed(false);
          setTranslateX(0);
        }
        armClickGuard(rowEl, guard);
        endGesture(false);
        return;
      }
    }
    if (locked !== "horizontal") return;
    setTranslateX(Math.max(-revealWidth - SWIPE_OVERSHOOT_PX, Math.min(0, startTranslate + dx)));
  }

  function onPointerUp(): void {
    endGesture(true);
  }

  function onPointerCancel(): void {
    // The browser stole the gesture: settle to the nearest state, never
    // toggle anything.
    endGesture(false);
  }

  /** Releases the gesture listeners and settles the row. `commitTap` is
   *  true on a real release — a tap then closes a revealed row; on a
   *  pointercancel the row stays as it was. */
  function endGesture(commitTap: boolean): void {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    setDragging(false);
    if (locked === "horizontal") {
      // Any drag past the slop must not activate the row underneath.
      armClickGuard(rowEl, guard);
      const committed = translateX() < -commitThreshold;
      setRevealed(committed);
      setTranslateX(committed ? -revealWidth : 0);
    } else if (locked === "none" && revealed() && commitTap) {
      // A plain tap on a revealed row closes it instead of navigating.
      setRevealed(false);
      setTranslateX(0);
      armClickGuard(rowEl, guard);
    }
    locked = "none";
  }

  function close(): void {
    setRevealed(false);
    setTranslateX(0);
  }

  onCleanup(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    disarmClickGuard(rowEl, guard);
  });

  return {
    handlers: { onPointerDown, onPointerUp, onPointerCancel },
    translateX,
    dragging,
    revealed,
    close,
  };
}

// --- long-press ------------------------------------------------------------

export interface LongPressHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
}

/** Hold-to-act: a pointer held still for `ms` fires `onLongPress` with the
 *  press position. Any drift past the slop cancels the hold (so scrolling
 *  or dragging never triggers it), as do pointerup and pointercancel. A
 *  successful hold arms the click guard, so releasing the finger cannot
 *  activate a button underneath. */
export function useLongPress(
  onLongPress: (position: { x: number; y: number }) => void,
  ms = LONG_PRESS_MS,
): LongPressHandlers {
  const guard = {
    stop: undefined as ((event: Event) => void) | undefined,
    timer: undefined as number | undefined,
  };

  let element: HTMLElement | undefined;
  let holdTimer: number | undefined;
  let startX = 0;
  let startY = 0;

  function clearHoldTimer(): void {
    if (holdTimer !== undefined) {
      window.clearTimeout(holdTimer);
      holdTimer = undefined;
    }
  }

  function release(): void {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    clearHoldTimer();
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    element = event.currentTarget as HTMLElement;
    startX = event.clientX;
    startY = event.clientY;
    clearHoldTimer();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    holdTimer = window.setTimeout(() => {
      holdTimer = undefined;
      armClickGuard(element, guard);
      onLongPress({ x: startX, y: startY });
    }, ms);
  }

  function onPointerMove(event: PointerEvent): void {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    // Any drift past the slop is a scroll or a tap elsewhere: cancel.
    if (Math.max(Math.abs(dx), Math.abs(dy)) > LONG_PRESS_SLOP_PX) clearHoldTimer();
  }

  function onPointerUp(): void {
    release();
  }

  function onPointerCancel(): void {
    release();
  }

  onCleanup(() => {
    release();
    disarmClickGuard(element, guard);
  });

  return { onPointerDown, onPointerUp, onPointerCancel };
}

// --- pull-to-refresh -------------------------------------------------------

export interface PullToRefresh {
  /** Ref for the scroll container (touch listeners attach here). */
  containerRef: (el: HTMLDivElement | undefined) => void;
  /** Current pull distance in px (0 when idle). */
  pull: Accessor<number>;
  /** True while a refresh round-trip is in flight (the pull holds). */
  refreshing: Accessor<boolean>;
  /** True while the finger is dragging (disable transitions). */
  dragging: Accessor<boolean>;
}

export interface PullToRefreshOptions {
  /** Called when the pull commits; the indicator holds until it settles. */
  onRefresh: () => Promise<unknown> | void;
  /** Pull distance (px) that commits the refresh. */
  threshold?: number;
  /** Rubber-band ceiling of the pull (px). */
  maxPull?: number;
}

/** Pull-down-to-refresh for a scroll container: while the container is at
 *  the very top, a downward touch drag is intercepted (touchmove is
 *  prevented, so it never fights the native scroll or rubber band) and
 *  reports the pull distance; releasing past the threshold runs
 *  `onRefresh` and holds the indicator until the returned promise settles
 *  (rejections are swallowed — a failed refresh is silent; the next pull
 *  retries). Releasing below the threshold, moving back up past the start,
 *  or a touchcancel aborts the pull. Touch events are used (not pointers):
 *  they are the only channel that can preventDefault the native vertical
 *  scroll while the container keeps its default touch-action. */
export function usePullToRefresh(options: PullToRefreshOptions): PullToRefresh {
  const threshold = options.threshold ?? 64;
  const maxPull = options.maxPull ?? 96;

  const [pull, setPull] = createSignal(0);
  const [refreshing, setRefreshing] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);
  const [container, setContainer] = createSignal<HTMLDivElement | undefined>();

  let startY = 0;
  let tracking = false;

  createEffect(() => {
    const el = container();
    if (el === undefined) return;
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    onCleanup(() => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    });
  });

  /** Ends a pull without refreshing and forgets the touch. */
  function abortPull(): void {
    tracking = false;
    setDragging(false);
    setPull(0);
  }

  function onTouchStart(event: TouchEvent): void {
    if (refreshing()) return;
    const el = container();
    const touch = event.touches?.[0];
    if (el === undefined || touch === undefined || el.scrollTop > 0) return;
    startY = touch.clientY;
    tracking = true;
  }

  function onTouchMove(event: TouchEvent): void {
    if (!tracking) return;
    const el = container();
    const touch = event.touches?.[0];
    if (el === undefined || touch === undefined) return;
    const dy = touch.clientY - startY;
    // Moving back up past the start kills the pull: the native scroll
    // takes over (this touchmove must NOT be prevented).
    if (dy <= 0 || el.scrollTop > 0) {
      abortPull();
      return;
    }
    // The pull is ours: preventing the move stops the native scroll and
    // rubber band while the finger drags the indicator down.
    event.preventDefault();
    setDragging(true);
    setPull(Math.min(dy, maxPull));
  }

  function onTouchEnd(): void {
    if (!tracking) return;
    tracking = false;
    setDragging(false);
    if (pull() < threshold) {
      setPull(0);
      return;
    }
    // Committed: hold the indicator while the refresh round-trip runs.
    setRefreshing(true);
    setPull(threshold);
    let result: unknown;
    try {
      result = options.onRefresh();
    } catch {
      // A synchronous throw is a failed refresh like any other.
      result = undefined;
    }
    Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => {
        setRefreshing(false);
        setPull(0);
      });
  }

  function onTouchCancel(): void {
    abortPull();
  }

  return {
    containerRef: setContainer,
    pull,
    refreshing,
    dragging,
  };
}

// --- edge swipe back -------------------------------------------------------

export interface EdgeSwipeHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
}

/** iOS-style right-swipe back from the left edge: a pointer that goes down
 *  inside the ~24px edge zone and then drags right past ~40px fires
 *  `onBack` once. Vertical drags abandon (the scroll owns them), as do
 *  pointercancel and releasing before the commit distance. Attach the
 *  handlers to the page root: the edge check reads the event's own
 *  clientX, so pointerdown on any child bubbles in and is evaluated. */
export function useEdgeSwipeBack(onBack: () => void): EdgeSwipeHandlers {
  let startX = 0;
  let startY = 0;
  let locked: "none" | "horizontal" | "vertical" = "none";
  let fired = false;

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (event.clientX > EDGE_ZONE_PX) return;
    startX = event.clientX;
    startY = event.clientY;
    locked = "none";
    fired = false;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  function onPointerMove(event: PointerEvent): void {
    if (fired) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (locked === "none") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < GESTURE_SLOP_PX) return;
      locked = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (locked === "vertical") {
        endGesture();
        return;
      }
    }
    if (locked !== "horizontal") return;
    if (dx >= EDGE_COMMIT_PX) {
      fired = true;
      endGesture();
      onBack();
    }
  }

  function onPointerUp(): void {
    endGesture();
  }

  function onPointerCancel(): void {
    endGesture();
  }

  function endGesture(): void {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    locked = "none";
  }

  onCleanup(endGesture);

  return { onPointerDown, onPointerUp, onPointerCancel };
}
