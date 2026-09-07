import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";
import type { JSX } from "solid-js";

const OPEN_MS = 240;
const CLOSE_MS = 180;
const OPEN_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const CLOSE_EASE = "cubic-bezier(0.4, 0, 1, 1)";

/** Retain the outgoing body until its height transition completes. */
export default function AnimatedDisclosure(props: {
  open: boolean;
  id?: string;
  children: JSX.Element;
}) {
  const [present, setPresent] = createSignal(untrack(() => props.open));
  let body!: HTMLDivElement;
  let animation: Animation | undefined;
  let initial = true;

  createEffect(() => {
    const open = props.open;
    untrack(() => {
      if (initial) {
        initial = false;
        return;
      }
      const height = body.getBoundingClientRect().height;
      animation?.cancel();
      if (open) setPresent(true);
      if (
        typeof body.animate !== "function" ||
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ) {
        setPresent(open);
        return;
      }
      animation = body.animate(
        open
          ? [
              {
                height: `${height}px`,
                opacity: 0.25,
                transform: "translateY(-4px) scaleY(0.985)",
              },
              {
                height: `${body.scrollHeight}px`,
                opacity: 1,
                transform: "translateY(0) scaleY(1)",
              },
            ]
          : [
              {
                height: `${height}px`,
                opacity: 1,
                transform: "translateY(0) scaleY(1)",
              },
              {
                height: "0px",
                opacity: 0,
                transform: "translateY(-3px) scaleY(0.99)",
              },
            ],
        { duration: open ? OPEN_MS : CLOSE_MS, easing: open ? OPEN_EASE : CLOSE_EASE },
      );
      animation.onfinish = () => {
        setPresent(open);
        animation = undefined;
      };
    });
  });
  onCleanup(() => animation?.cancel());

  return (
    <div
      ref={body}
      id={props.id}
      class="chat-disclosure"
      aria-hidden={!props.open}
      inert={!props.open}
    >
      <Show when={present()}>{props.children}</Show>
    </div>
  );
}
