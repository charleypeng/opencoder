import {
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import type { JSX } from "solid-js";
import { useT } from "../../i18n/index.js";
import { readActivityExpanded, writeActivityExpanded } from "./activity/activityViewState.js";

/** Measure rendered height so wrapping, markdown and UI scaling share one limit. */
export default function UserMessageContent(props: { messageKey: string; children: JSX.Element }) {
  const t = useT();
  const id = createUniqueId();
  const [expanded, setExpanded] = createSignal(
    untrack(() => readActivityExpanded(props.messageKey)),
  );
  const [height, setHeight] = createSignal(0);
  const [limit, setLimit] = createSignal(192);
  const long = () => height() > limit() + 24;
  let content!: HTMLDivElement;
  let viewport!: HTMLDivElement;
  let animation: Animation | undefined;

  onMount(() => {
    const measure = () => {
      setLimit((parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 12);
      setHeight(content.getBoundingClientRect().height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(document.documentElement);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    viewport.style.height = long() && !expanded() ? `${limit()}px` : "auto";
  });
  onCleanup(() => animation?.cancel());

  function toggle() {
    const previous = viewport.getBoundingClientRect().height;
    animation?.cancel();
    const next = !expanded();
    // Keep the fold control in view when a very tall message contracts.
    if (!next && viewport.getBoundingClientRect().top < 0) {
      viewport.scrollIntoView?.({ block: "start", behavior: "instant" });
    }
    setExpanded(next);
    writeActivityExpanded(props.messageKey, next);
    if (
      typeof viewport.animate === "function" &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      animation = viewport.animate(
        [{ height: `${previous}px` }, { height: `${next ? height() : limit()}px` }],
        { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
  }

  return (
    <>
      <div
        ref={viewport}
        id={id}
        data-testid="user-message-content"
        class="user-message-content"
        data-collapsed={long() && !expanded()}
      >
        <div ref={content} inert={long() && !expanded()}>
          {props.children}
        </div>
      </div>
      <Show when={long()}>
        <button
          type="button"
          data-testid="user-message-toggle"
          aria-expanded={expanded()}
          aria-controls={id}
          onClick={toggle}
          class="mt-1 rounded-sm px-1 py-1 text-xs text-fg-secondary hover:bg-bg-sunken/50 focus-visible:outline-accent"
        >
          {t(expanded() ? "messages:collapseUserMessage" : "messages:expandUserMessage")}
          <span
            aria-hidden="true"
            class={`ml-1 inline-block transition-transform ${expanded() ? "rotate-180" : ""}`}
          >
            ⌄
          </span>
        </button>
      </Show>
    </>
  );
}
