// Breathing typing caret (TASK-M2-09): an inline caret that sits at the end
// of the last rendered token of a streaming text part. The caret is appended
// INSIDE the markdown container (into the last paragraph when there is one)
// so it follows the text on the same line. MarkdownText re-renders its
// innerHTML on every delta, which destroys the appended node, so the caret
// effect re-runs on `track()` (the part text) and re-appends; on unmount
// (streaming ended) it removes itself.
//
// The breathing glow is pure CSS (`.typing-cursor` in styles/index.css) and
// is disabled under prefers-reduced-motion.

import { createEffect, onCleanup } from "solid-js";
import type { Component } from "solid-js";

export interface TypingCursorProps {
  /** Resolves the markdown container the caret should live in. */
  host: () => HTMLElement | undefined;
  /** Reactive value (the part text) whose changes re-append the caret. */
  track: () => unknown;
}

const TypingCursor: Component<TypingCursorProps> = (props) => {
  createEffect(() => {
    void props.track();
    const host = props.host();
    if (host === undefined) return;
    const caret = document.createElement("span");
    caret.className = "typing-cursor";
    caret.dataset.testid = "typing-cursor";
    const anchor = host.querySelector("p:last-of-type") ?? host;
    anchor.appendChild(caret);
    onCleanup(() => caret.remove());
  });
  return null;
};

export default TypingCursor;
