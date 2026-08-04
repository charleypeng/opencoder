// Text part renderer (TASK-M2-07): renders the part's text as markdown
// (GFM + Shiki-highlighted code blocks); plain pre-wrap was the M2-06
// placeholder until markdown rendering landed.
//
// TASK-M2-09: `streaming` mounts the breathing typing caret at the end of
// the part's last rendered token while the message is still receiving
// deltas (only the last text part of the streaming message gets it).

import { Show } from "solid-js";
import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import MarkdownText from "../markdown/MarkdownText.js";
import TypingCursor from "../TypingCursor.js";

export type TextPartData = Extract<Part, { type: "text" }>;

export interface TextPartProps {
  part: TextPartData;
  /** Renders the breathing caret at the end of the streaming text. */
  streaming?: boolean;
}

const TextPart: Component<TextPartProps> = (props) => {
  let rootRef: HTMLDivElement | undefined;
  // The caret host is the markdown container inside this part's box; the
  // container element survives innerHTML re-renders (it is replaced only
  // when the part row itself is re-created).
  const host = () =>
    rootRef?.querySelector<HTMLElement>('[data-testid="markdown-text"]') ?? undefined;

  return (
    <div ref={rootRef} data-testid="text-part">
      <MarkdownText text={props.part.text} />
      <Show when={props.streaming === true}>
        <TypingCursor host={host} track={() => props.part.text} />
      </Show>
    </div>
  );
};

export default TextPart;
