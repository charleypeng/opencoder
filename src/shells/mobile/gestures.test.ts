// L1 tests for the mobile gesture hooks (TASK-M7-06): direction lock
// (horizontal gestures own the pointer, vertical ones abandon to the
// scroll), commit thresholds (swipe reveal past 40px, edge swipe past
// 40px, pull-to-refresh past 64px), cancel paths (pointercancel settles
// without firing; touchcancel aborts a pull) and timer/listener cleanup.
// Pointer gestures are driven with PointerEvents (jsdom supports the
// constructor); touch gestures with TouchEvents whose `touches` is
// injected via defineProperty (jsdom has no Touch constructor).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@solidjs/testing-library";
import { createEffect, createRoot } from "solid-js";
import {
  EDGE_COMMIT_PX,
  EDGE_ZONE_PX,
  SWIPE_COMMIT_PX,
  SWIPE_REVEAL_PX,
  useEdgeSwipeBack,
  useLongPress,
  usePullToRefresh,
  useSwipeActions,
} from "./gestures";

/** Runs `setup` inside a root and returns its disposer (no JSX needed —
 *  the hooks are driven through real elements + dispatched events). */
function mount(setup: (dispose: () => void) => void): () => void {
  return createRoot((dispose) => {
    setup(dispose);
    return dispose;
  });
}

/** Mounts a swipeable row: an outer element with the hook handlers and an
 *  inner button that reports clicks. */
function mountSwipeRow(props: { revealWidth?: number; onClick?: () => void } = {}) {
  const row = document.createElement("div");
  row.setAttribute("data-testid", "swipe-row");
  const inner = document.createElement("button");
  inner.setAttribute("data-testid", "row-inner");
  inner.addEventListener("click", () => props.onClick?.());
  row.appendChild(inner);
  const disposer = mount(() => {
    const swipe = useSwipeActions({ revealWidth: props.revealWidth });
    row.addEventListener("pointerdown", swipe.handlers.onPointerDown);
    createEffect(() => {
      row.style.transform = `translateX(${swipe.translateX()}px)`;
    });
    createEffect(() => {
      row.setAttribute("data-revealed", swipe.revealed() ? "1" : "0");
    });
    document.body.appendChild(row);
  });
  return { row, disposer };
}

/** Mounts a long-press host with an inner clickable button. */
function mountLongPress(
  props: {
    ms?: number;
    onLongPress?: (position: { x: number; y: number }) => void;
    onInnerClick?: () => void;
  } = {},
) {
  const host = document.createElement("div");
  host.setAttribute("data-testid", "hold");
  const inner = document.createElement("button");
  inner.setAttribute("data-testid", "hold-inner");
  inner.addEventListener("click", () => props.onInnerClick?.());
  host.appendChild(inner);
  const disposer = mount(() => {
    const handlers = useLongPress(props.onLongPress ?? (() => undefined), props.ms);
    host.addEventListener("pointerdown", handlers.onPointerDown);
    document.body.appendChild(host);
  });
  return { host, disposer };
}

/** Mounts a pull-to-refresh scroll container with a height-driven
 *  indicator. */
function mountPtr(props: { onRefresh?: () => Promise<void>; threshold?: number } = {}) {
  const scroll = document.createElement("div");
  scroll.setAttribute("data-testid", "scroll");
  scroll.style.height = "200px";
  scroll.style.overflow = "auto";
  const indicator = document.createElement("div");
  indicator.setAttribute("data-testid", "indicator");
  const content = document.createElement("div");
  content.style.height = "600px";
  scroll.appendChild(indicator);
  scroll.appendChild(content);
  const disposer = mount(() => {
    const ptr = usePullToRefresh({
      onRefresh: props.onRefresh ?? (async () => undefined),
      threshold: props.threshold,
    });
    ptr.containerRef(scroll);
    createEffect(() => {
      indicator.style.height = `${ptr.pull()}px`;
    });
    createEffect(() => {
      scroll.setAttribute("data-refreshing", ptr.refreshing() ? "1" : "0");
    });
    document.body.appendChild(scroll);
  });
  return { scroll, indicator, disposer };
}

/** Mounts an edge-swipe back page. */
function mountEdge(props: { onBack?: () => void } = {}) {
  const page = document.createElement("div");
  page.setAttribute("data-testid", "edge");
  const disposer = mount(() => {
    const handlers = useEdgeSwipeBack(props.onBack ?? (() => undefined));
    page.addEventListener("pointerdown", handlers.onPointerDown);
    document.body.appendChild(page);
  });
  return { page, disposer };
}

/** Swipes the row horizontally from (x, y) by (dx, dy) and releases. */
function dragRow(x: number, y: number, dx: number, dy: number): void {
  fireEvent.pointerDown(screen.getByTestId("swipe-row"), { clientX: x, clientY: y, button: 0 });
  fireEvent.pointerMove(window, { clientX: x + dx, clientY: y + dy });
  fireEvent.pointerUp(window, { clientX: x + dx, clientY: y + dy });
}

/** A touch event with the given clientY in `touches` (jsdom lacks Touch). */
function touchEvent(type: string, clientY: number): TouchEvent {
  const event = new TouchEvent(type, { cancelable: true });
  const touch = { clientY } as Touch;
  Object.defineProperty(event, "touches", { value: [touch], configurable: true });
  Object.defineProperty(event, "changedTouches", { value: [touch], configurable: true });
  return event;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useSwipeActions", () => {
  it("reveals the row past the commit threshold and closes it again past the threshold", () => {
    mountSwipeRow();
    const row = screen.getByTestId("swipe-row");

    // A 100px leftward drag (commit threshold is 40px) commits the reveal.
    dragRow(200, 100, -100, 0);
    expect(row.style.transform).toBe("translateX(-80px)");
    expect(row).toHaveAttribute("data-revealed", "1");

    // A 100px rightward drag closes it again.
    dragRow(200, 100, 100, 0);
    expect(row.style.transform).toBe("translateX(0px)");
    expect(row).toHaveAttribute("data-revealed", "0");
  });

  it("small drags are mis-touches: a closed row stays closed, an open one stays open", () => {
    mountSwipeRow();
    const row = screen.getByTestId("swipe-row");

    // A 20px leftward drag on a closed row never opens it.
    dragRow(200, 100, -20, 0);
    expect(row.style.transform).toBe("translateX(0px)");
    expect(row).toHaveAttribute("data-revealed", "0");

    // Open it, then nudge it slightly: it stays open (threshold respected).
    dragRow(200, 100, -100, 0);
    dragRow(200, 100, -20, 0);
    expect(row.style.transform).toBe("translateX(-80px)");
    expect(row).toHaveAttribute("data-revealed", "1");
  });

  it("respects a custom reveal width", () => {
    mountSwipeRow({ revealWidth: 128 });
    const row = screen.getByTestId("swipe-row");

    dragRow(200, 100, -200, 0);
    expect(row.style.transform).toBe("translateX(-128px)");
  });

  it("abandons vertical drags so the scroll keeps them", () => {
    mountSwipeRow();
    const row = screen.getByTestId("swipe-row");

    // Vertical drag: never any horizontal translation.
    dragRow(200, 100, 0, 80);
    expect(row.style.transform).toBe("translateX(0px)");
    expect(row).toHaveAttribute("data-revealed", "0");
  });

  it("a tap on a revealed row closes it and swallows the click", () => {
    const onClick = vi.fn();
    mountSwipeRow({ onClick });
    const row = screen.getByTestId("swipe-row");

    dragRow(200, 100, -100, 0);
    expect(row).toHaveAttribute("data-revealed", "1");

    // Tap (no movement): closes the reveal.
    fireEvent.pointerDown(row, { clientX: 200, clientY: 100, button: 0 });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 100 });
    expect(row.style.transform).toBe("translateX(0px)");
    expect(row).toHaveAttribute("data-revealed", "0");
    // The click that follows the release is swallowed (no navigation).
    fireEvent.click(screen.getByTestId("row-inner"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("a plain tap on a closed row keeps the click working", () => {
    const onClick = vi.fn();
    mountSwipeRow({ onClick });

    fireEvent.pointerDown(screen.getByTestId("swipe-row"), {
      clientX: 200,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 100 });
    fireEvent.click(screen.getByTestId("row-inner"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a swipe ending on the row does not activate it", () => {
    const onClick = vi.fn();
    mountSwipeRow({ onClick });

    dragRow(200, 100, -100, 0);
    fireEvent.click(screen.getByTestId("row-inner"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("pointercancel mid-drag settles to the nearest state and releases the listeners", () => {
    mountSwipeRow();
    const row = screen.getByTestId("swipe-row");

    // Drag 30px (below the commit threshold) then cancel: snaps back.
    fireEvent.pointerDown(row, { clientX: 200, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 170, clientY: 100 });
    fireEvent.pointerCancel(window, { clientX: 170, clientY: 100 });
    expect(row.style.transform).toBe("translateX(0px)");
    expect(row).toHaveAttribute("data-revealed", "0");

    // The window listeners are gone: a stray move changes nothing.
    fireEvent.pointerMove(window, { clientX: 120, clientY: 100 });
    expect(row.style.transform).toBe("translateX(0px)");
  });

  it("unmounting mid-drag removes the window listeners", () => {
    const { row, disposer } = mountSwipeRow();

    fireEvent.pointerDown(row, { clientX: 200, clientY: 100, button: 0 });
    disposer();
    // No error and nothing crashes — the listeners are detached.
    fireEvent.pointerMove(window, { clientX: 150, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 100 });
  });
});

describe("useLongPress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("fires after the hold time with the press position", () => {
    const onLongPress = vi.fn();
    mountLongPress({ ms: 500, onLongPress });

    fireEvent.pointerDown(screen.getByTestId("hold"), { clientX: 40, clientY: 50, button: 0 });
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledWith({ x: 40, y: 50 });
  });

  it("releasing before the hold time cancels the timer", () => {
    const onLongPress = vi.fn();
    mountLongPress({ ms: 500, onLongPress });

    fireEvent.pointerDown(screen.getByTestId("hold"), { clientX: 40, clientY: 50, button: 0 });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 50 });
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("movement past the slop cancels the hold (scroll doesn't trigger it)", () => {
    const onLongPress = vi.fn();
    mountLongPress({ ms: 500, onLongPress });

    fireEvent.pointerDown(screen.getByTestId("hold"), { clientX: 40, clientY: 50, button: 0 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 50 });
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("pointercancel cancels the hold", () => {
    const onLongPress = vi.fn();
    mountLongPress({ ms: 500, onLongPress });

    fireEvent.pointerDown(screen.getByTestId("hold"), { clientX: 40, clientY: 50, button: 0 });
    fireEvent.pointerCancel(window, { clientX: 40, clientY: 50 });
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("a click after a successful hold is swallowed", () => {
    const onInnerClick = vi.fn();
    mountLongPress({ ms: 500, onInnerClick });

    fireEvent.pointerDown(screen.getByTestId("hold"), { clientX: 40, clientY: 50, button: 0 });
    vi.advanceTimersByTime(500);
    fireEvent.pointerUp(window, { clientX: 40, clientY: 50 });
    fireEvent.click(screen.getByTestId("hold-inner"));
    expect(onInnerClick).not.toHaveBeenCalled();
  });

  it("unmounting before the hold fires cleans up the timer", () => {
    const onLongPress = vi.fn();
    const { host, disposer } = mountLongPress({ ms: 500, onLongPress });

    fireEvent.pointerDown(host, { clientX: 40, clientY: 50, button: 0 });
    disposer();
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe("usePullToRefresh", () => {
  it("tracks the pull distance and prevents the native scroll", () => {
    mountPtr();
    const scroll = screen.getByTestId("scroll");
    const indicator = screen.getByTestId("indicator");

    fireEvent(scroll, touchEvent("touchstart", 0));
    const move = touchEvent("touchmove", 40);
    fireEvent(scroll, move);
    expect(move.defaultPrevented).toBe(true);
    expect(indicator.style.height).toBe("40px");
  });

  it("releasing below the threshold snaps back without refreshing", async () => {
    const onRefresh = vi.fn(async () => undefined);
    mountPtr({ onRefresh });
    const scroll = screen.getByTestId("scroll");

    fireEvent(scroll, touchEvent("touchstart", 0));
    fireEvent(scroll, touchEvent("touchmove", 40));
    fireEvent(scroll, touchEvent("touchend", 40));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("indicator").style.height).toBe("0px");
  });

  it("releasing past the threshold refreshes and holds the indicator until it settles", async () => {
    let resolveRefresh: () => void = () => undefined;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => (resolveRefresh = resolve)));
    mountPtr({ onRefresh });
    const scroll = screen.getByTestId("scroll");

    fireEvent(scroll, touchEvent("touchstart", 0));
    fireEvent(scroll, touchEvent("touchmove", 80));
    fireEvent(scroll, touchEvent("touchend", 80));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    // The indicator holds at the threshold while the round-trip is in flight.
    expect(screen.getByTestId("indicator").style.height).toBe("64px");
    expect(scroll).toHaveAttribute("data-refreshing", "1");

    resolveRefresh();
    await Promise.resolve();
    await Promise.resolve();
    expect(scroll).toHaveAttribute("data-refreshing", "0");
    expect(screen.getByTestId("indicator").style.height).toBe("0px");
  });

  it("a failing refresh still releases the indicator", async () => {
    const onRefresh = vi.fn(async () => {
      throw new Error("boom");
    });
    mountPtr({ onRefresh });
    const scroll = screen.getByTestId("scroll");

    fireEvent(scroll, touchEvent("touchstart", 0));
    fireEvent(scroll, touchEvent("touchmove", 80));
    fireEvent(scroll, touchEvent("touchend", 80));
    expect(scroll).toHaveAttribute("data-refreshing", "1");

    await Promise.resolve();
    await Promise.resolve();
    expect(scroll).toHaveAttribute("data-refreshing", "0");
    expect(screen.getByTestId("indicator").style.height).toBe("0px");
  });

  it("does not pull when the container is scrolled down", () => {
    mountPtr();
    const scroll = screen.getByTestId("scroll");
    scroll.scrollTop = 100;

    fireEvent(scroll, touchEvent("touchstart", 0));
    fireEvent(scroll, touchEvent("touchmove", 40));
    expect(screen.getByTestId("indicator").style.height).toBe("0px");
  });

  it("moving back up past the start cancels the pull", () => {
    mountPtr();
    const scroll = screen.getByTestId("scroll");

    fireEvent(scroll, touchEvent("touchstart", 100));
    fireEvent(scroll, touchEvent("touchmove", 140));
    expect(screen.getByTestId("indicator").style.height).toBe("40px");
    // Back past the start: dead, and the native scroll is NOT prevented.
    const move = touchEvent("touchmove", 90);
    fireEvent(scroll, move);
    expect(move.defaultPrevented).toBe(false);
    expect(screen.getByTestId("indicator").style.height).toBe("0px");
  });

  it("touchcancel aborts the pull", () => {
    mountPtr();
    const scroll = screen.getByTestId("scroll");

    fireEvent(scroll, touchEvent("touchstart", 0));
    fireEvent(scroll, touchEvent("touchmove", 40));
    fireEvent(scroll, touchEvent("touchcancel", 40));
    expect(screen.getByTestId("indicator").style.height).toBe("0px");
  });

  it("ignores new touches while a refresh is in flight", async () => {
    let resolveRefresh: () => void = () => undefined;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => (resolveRefresh = resolve)));
    mountPtr({ onRefresh });
    const scroll = screen.getByTestId("scroll");

    fireEvent(scroll, touchEvent("touchstart", 0));
    fireEvent(scroll, touchEvent("touchmove", 80));
    fireEvent(scroll, touchEvent("touchend", 80));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // A new pull attempt while refreshing must not double-fire.
    fireEvent(scroll, touchEvent("touchstart", 0));
    fireEvent(scroll, touchEvent("touchmove", 80));
    fireEvent(scroll, touchEvent("touchend", 80));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    resolveRefresh();
    await Promise.resolve();
    await Promise.resolve();
    expect(scroll).toHaveAttribute("data-refreshing", "0");
  });
});

describe("useEdgeSwipeBack", () => {
  it("pops when a rightward drag starts inside the edge zone and passes the commit distance", () => {
    const onBack = vi.fn();
    mountEdge({ onBack });

    fireEvent.pointerDown(screen.getByTestId("edge"), { clientX: 10, clientY: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: EDGE_ZONE_PX + EDGE_COMMIT_PX, clientY: 200 });
    expect(onBack).toHaveBeenCalledTimes(1);
    // Release after the pop: no double fire.
    fireEvent.pointerUp(window, { clientX: EDGE_ZONE_PX + EDGE_COMMIT_PX, clientY: 200 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("ignores pointerdown outside the edge zone", () => {
    const onBack = vi.fn();
    mountEdge({ onBack });

    fireEvent.pointerDown(screen.getByTestId("edge"), { clientX: 100, clientY: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200 });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("releasing before the commit distance does not pop", () => {
    const onBack = vi.fn();
    mountEdge({ onBack });

    fireEvent.pointerDown(screen.getByTestId("edge"), { clientX: 10, clientY: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 200 });
    fireEvent.pointerUp(window, { clientX: 30, clientY: 200 });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("vertical drags abandon (the scroll keeps them)", () => {
    const onBack = vi.fn();
    mountEdge({ onBack });

    fireEvent.pointerDown(screen.getByTestId("edge"), { clientX: 10, clientY: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 300 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 340 });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 340 });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("pointercancel cancels the gesture", () => {
    const onBack = vi.fn();
    mountEdge({ onBack });

    fireEvent.pointerDown(screen.getByTestId("edge"), { clientX: 10, clientY: 200, button: 0 });
    // Below the commit distance, then the browser steals the gesture.
    fireEvent.pointerMove(window, { clientX: 30, clientY: 200 });
    fireEvent.pointerCancel(window, { clientX: 30, clientY: 200 });
    expect(onBack).not.toHaveBeenCalled();
  });
});

// Referenced to keep the exported constants' coverage trivial and pin the
// thresholds in one place (import-time smoke).
describe("threshold constants", () => {
  it("matches the hook defaults", () => {
    expect(SWIPE_REVEAL_PX).toBe(80);
    expect(SWIPE_COMMIT_PX).toBe(40);
    expect(EDGE_ZONE_PX).toBe(24);
    expect(EDGE_COMMIT_PX).toBe(40);
  });
});
