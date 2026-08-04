// Bottom sheet base component (TASK-M7-05, docs/ui-design.md §4.1 "Sheet
// 体系"): a fixed scrim plus a bottom-anchored panel with three snap
// positions — 25% (low) / 60% (mid) / 95% (high) of the viewport height —
// driven by pointer gestures on the drag handle and the panel itself.
// A downward drag past the threshold (~120px) or a fast downward flick
// closes the sheet; any other release settles to the NEAREST snap with the
// --ease-spring timing curve (the panel height is the high snap's 95vh, so
// geometry stays fixed and settling is a pure translate). While dragging
// the transition is disabled so the panel follows the pointer 1:1.
// prefers-reduced-motion degrades both layers: the tokens media query
// zeroes --dur-med (any CSS var() consumer) and the JS uses a 0ms linear
// transition + settles without the rAF handoff. The panel is
// role="dialog" + aria-modal, focus moves to it on open and returns to
// the previously focused element on close, Esc closes, and the body
// scroll locks while open.
// The `dismissible` flag gates the close triggers (scrim / Esc /
// drag-down): the permission and question sheets keep it false — a
// request must be answered, not skipped.

import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { Component, JSX } from "solid-js";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Rest position as a viewport percentage: low 25% / mid 60% / high 95%. */
  snap?: "low" | "mid" | "high";
  /** Optional heading shown above the content. */
  title?: string;
  /** False makes scrim / Esc / drag-down no-ops (permission + question
   *  sheets must be answered, not skipped). */
  dismissible?: boolean;
  /** Test id of the panel element (scrim/handle derive from it). */
  testId?: string;
  children: JSX.Element;
}

/** Panel height: the high snap (95vh) so geometry never changes mid-gesture. */
const PANEL_PCT = 95;
/** Visible panel share per snap: low 25% / mid 60% / high 95% of the
 *  viewport height (a translateY offset leaves that share visible). */
const SNAP_PCT: Record<"low" | "mid" | "high", number> = {
  low: 25,
  mid: 60,
  high: 95,
};
/** Downward drag past this many pixels closes the sheet. */
const CLOSE_THRESHOLD_PX = 120;
/** A downward drag faster than this (px per ms) flicks the sheet closed. */
const FLICK_VELOCITY_PX_MS = 0.8;
/** Vertical drag larger than this counts as a real drag, not a tap. */
const DRAG_SLOP_PX = 4;
/** How long the post-drag click guard stays armed (ms). */
const SUPPRESS_CLICK_MS = 500;

/** Schedules `callback` after the browser has painted the current frame. */
function nextFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(callback));
  } else {
    callback();
  }
}

const Sheet: Component<SheetProps> = (props) => {
  const snap = (): "low" | "mid" | "high" => props.snap ?? "mid";
  const testId = (): string => props.testId ?? "sheet";
  const dismissible = (): boolean => props.dismissible ?? true;

  const viewportHeight = (): number => window.innerHeight || 0;

  /** translateY (px) that leaves `pct` percent of the panel visible. */
  const snapOffset = (): number =>
    Math.round((viewportHeight() * (PANEL_PCT - SNAP_PCT[snap()])) / 100);

  const reducedMotion = (): boolean =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  // Current translateY (px). Starts fully below the viewport.
  const [offset, setOffset] = createSignal(viewportHeight());
  // True once the panel settled into its snap (scrim fades in meanwhile).
  const [ready, setReady] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);

  let panelEl: HTMLDivElement | undefined;
  let activeElementBefore: HTMLElement | null = null;
  let panelHadFocus = false;
  let startY = 0;
  let startOffset = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  // One-shot click guard armed after a real drag (see onPointerUp).
  let suppressClickStop: ((event: Event) => void) | undefined;
  let suppressClickTimer: number | undefined;

  /** Disarms the post-drag click guard (self-removal path). */
  function clearClickSuppression(): void {
    if (suppressClickStop !== undefined && panelEl !== undefined) {
      panelEl.removeEventListener("click", suppressClickStop, true);
    }
    suppressClickStop = undefined;
    if (suppressClickTimer !== undefined) {
      window.clearTimeout(suppressClickTimer);
      suppressClickTimer = undefined;
    }
  }

  // Open lifecycle: start off-screen, paint, then spring to the snap;
  // capture the focus owner and body overflow to restore on close.
  createEffect(() => {
    if (!props.open) return;
    activeElementBefore = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelEl?.focus({ preventScroll: true });
    panelHadFocus = document.activeElement === panelEl;
    setOffset(viewportHeight());
    setReady(false);
    if (reducedMotion()) {
      setReady(true);
    } else {
      // Double rAF lets the browser paint the off-screen start before the
      // spring settles the panel into its snap.
      nextFrame(() => setReady(true));
    }
    onCleanup(() => {
      document.body.style.overflow = previousOverflow;
      // Reset off-screen so a re-open never flashes the stale position.
      setOffset(viewportHeight());
      setReady(false);
      // The panel may already be removed from the DOM at cleanup time, so
      // restore focus from the captured flag rather than the live element.
      if (panelHadFocus) {
        activeElementBefore?.focus?.({ preventScroll: true });
        panelHadFocus = false;
      }
    });
  });

  // Snap settling: drives both the open handoff and snap-prop changes
  // while open. Skipped mid-drag so the pointer position stays 1:1, and
  // the flush right after a gesture end is skipped too — onPointerUp
  // already settled to the NEAREST snap, which may differ from the prop.
  let gestureSettled = false;
  createEffect(() => {
    if (!props.open || !ready() || dragging()) return;
    if (gestureSettled) {
      gestureSettled = false;
      return;
    }
    setOffset(snapOffset());
  });

  // Esc closes (gated by dismissible).
  createEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible()) props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  // Gesture teardown: a drag interrupted by an unmount must not leak
  // window listeners or the post-drag click guard.
  onCleanup(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    clearClickSuppression();
  });

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    startY = event.clientY;
    startOffset = offset();
    lastY = event.clientY;
    lastT = performance.now();
    velocity = 0;
    setDragging(true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    // Keep the browser from starting text selection / native drags.
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    const now = performance.now();
    const dt = Math.max(now - lastT, 1);
    velocity = (event.clientY - lastY) / dt;
    lastY = event.clientY;
    lastT = now;
    const vh = viewportHeight();
    setOffset(Math.min(Math.max(startOffset + (event.clientY - startY), 0), vh));
  }

  function onPointerUp(): void {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    const delta = offset() - startOffset;
    // A drag that moved past the slop must not click what is underneath:
    // swallow the click that immediately follows the gesture. Panel-scoped
    // (capture phase) and self-removing, so a stray later tap is never
    // lost and nothing leaks past the panel's life.
    if (Math.abs(delta) > DRAG_SLOP_PX) {
      clearClickSuppression();
      suppressClickStop = (event) => {
        event.stopPropagation();
        event.preventDefault();
        clearClickSuppression();
      };
      suppressClickTimer = window.setTimeout(clearClickSuppression, SUPPRESS_CLICK_MS);
      panelEl?.addEventListener("click", suppressClickStop, true);
    }
    if (dismissible() && (delta > CLOSE_THRESHOLD_PX || velocity > FLICK_VELOCITY_PX_MS)) {
      setDragging(false);
      props.onClose();
      return;
    }
    // Settle BEFORE releasing the drag flag: the settle effect flushes
    // synchronously on the flag write and must see gestureSettled set.
    settle();
    setDragging(false);
  }

  /** Springs to whichever snap is closest to the current offset. */
  function settle(): void {
    const targets = (Object.keys(SNAP_PCT) as ("low" | "mid" | "high")[]).map((key) =>
      Math.round((viewportHeight() * (PANEL_PCT - SNAP_PCT[key])) / 100),
    );
    let best = targets[0];
    for (const px of targets) {
      if (Math.abs(offset() - px) < Math.abs(offset() - best)) best = px;
    }
    setOffset(best);
    // The settle-effect must not re-snap to the prop after a gesture.
    gestureSettled = true;
  }

  const transitionStyle = (): string =>
    dragging()
      ? "none"
      : reducedMotion()
        ? "transform 0ms linear"
        : "transform var(--dur-med) var(--ease-spring)";

  return (
    <Show when={props.open}>
      {/* Scrim: fades in behind the panel; a click closes (gated). */}
      <div
        data-testid={`${testId()}-scrim`}
        aria-hidden="true"
        class="fixed inset-0 z-40 bg-black/50"
        style={{
          opacity: ready() ? 1 : 0,
          transition: reducedMotion() ? "opacity 0ms linear" : "opacity var(--dur-med) ease-out",
        }}
        onClick={() => {
          if (dismissible()) props.onClose();
        }}
      />
      <div
        ref={panelEl}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        data-testid={testId()}
        data-snap={snap()}
        data-reduced-motion={reducedMotion() ? "true" : "false"}
        tabIndex={-1}
        class="fixed inset-x-0 bottom-0 z-50 flex flex-col border-t border-x border-bg-sunken bg-bg-elevated pb-safe shadow-[0_-8px_32px_rgba(0,0,0,0.24)] outline-none"
        style={{
          height: `${PANEL_PCT}vh`,
          "border-radius": "var(--r-xl) var(--r-xl) 0 0",
          transform: `translateY(${offset()}px)`,
          transition: transitionStyle(),
          "touch-action": "pan-y",
        }}
        onPointerDown={onPointerDown}
      >
        <div
          data-testid={`${testId()}-handle`}
          class="flex shrink-0 touch-none cursor-grab justify-center pb-1 pt-2 active:cursor-grabbing"
        >
          <div class="h-1.5 w-10 rounded-full bg-fg-faint/60" />
        </div>
        <Show when={props.title}>
          <h2 class="shrink-0 px-4 pb-2 text-md font-semibold text-fg-primary">{props.title}</h2>
        </Show>
        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">{props.children}</div>
      </div>
    </Show>
  );
};

export default Sheet;
