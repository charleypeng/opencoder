import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";
import type { JSX } from "solid-js";

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
        [
          { height: `${height}px`, opacity: open ? 0.35 : 1 },
          { height: `${open ? body.scrollHeight : 0}px`, opacity: open ? 1 : 0 },
        ],
        { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
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
