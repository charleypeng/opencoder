import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { Component } from "solid-js";

const OVERFLOW_EPSILON_PX = 1;
const MIN_DURATION_SECONDS = 6;
const PIXELS_PER_SECOND = 28;

/** Whether a label needs the hover/focus marquee rather than static text. */
export function marqueeOverflowPx(clientWidth: number, scrollWidth: number): number {
  return Math.max(0, scrollWidth - clientWidth - OVERFLOW_EPSILON_PX);
}

/**
 * Keeps session titles compact until they overflow, then reveals the complete
 * label with a slow, interruptible marquee on hover or keyboard focus.
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

  const duration = () => Math.max(MIN_DURATION_SECONDS, overflowPx() / PIXELS_PER_SECOND);

  return (
    <span
      ref={viewport}
      data-testid={props.testId}
      data-overflow={overflowPx() > 0 ? "true" : "false"}
      title={props.text}
      class="session-title-marquee-viewport block min-w-0 flex-1 overflow-hidden"
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
