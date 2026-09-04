import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { Component } from "solid-js";

const OVERFLOW_EPSILON_PX = 1;
const MARQUEE_SPEED_MULTIPLIER = 1.3;
const MIN_DURATION_SECONDS = 6 / MARQUEE_SPEED_MULTIPLIER;
const PIXELS_PER_SECOND = 28 * MARQUEE_SPEED_MULTIPLIER;

/** Whether a label needs the hover/focus marquee rather than static text. */
export function marqueeOverflowPx(clientWidth: number, scrollWidth: number): number {
  return Math.max(0, scrollWidth - clientWidth - OVERFLOW_EPSILON_PX);
}

/** Calculates the marquee duration after applying the 30% speed increase. */
export function marqueeDurationSeconds(overflowPx: number): number {
  return Math.max(MIN_DURATION_SECONDS, overflowPx / PIXELS_PER_SECOND);
}

/**
 * Keeps session titles compact until they overflow, then reveals the complete
 * label with an interruptible marquee on hover or keyboard focus.
 */
const OverflowMarquee: Component<{ text: string; testId?: string }> = (props) => {
  const [overflowPx, setOverflowPx] = createSignal(0);
  let viewport: HTMLSpanElement | undefined;

  function measure() {
    const element = viewport;
    if (element === undefined) return;
    setOverflowPx(marqueeOverflowPx(element.clientWidth, element.scrollWidth));
  }

  createEffect(() => {
    void props.text;
    queueMicrotask(measure);
  });

  onMount(() => {
    measure();
    window.addEventListener("resize", measure);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && viewport !== undefined) {
      observer = new ResizeObserver(measure);
      observer.observe(viewport);
    }
    onCleanup(() => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    });
  });

  const duration = () => marqueeDurationSeconds(overflowPx());

  return (
    <span
      ref={viewport}
      data-testid={props.testId}
      data-overflow={overflowPx() > 0 ? "true" : "false"}
      title={props.text}
      class="session-title-marquee-viewport block min-w-0 flex-1 overflow-hidden text-xs"
    >
      <span
        class="session-title-marquee-content inline-block whitespace-nowrap"
        style={{
          "--session-title-marquee-distance": `-${overflowPx()}px`,
          "--session-title-marquee-duration": `${duration()}s`,
        }}
      >
        {props.text}
      </span>
    </span>
  );
};

export default OverflowMarquee;
