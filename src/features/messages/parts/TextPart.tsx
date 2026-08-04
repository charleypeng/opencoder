// Text part renderer (TASK-M2-06): plain message text with preserved
// whitespace and wrapping. Markdown rendering lands in TASK-M2-07.

import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";

export type TextPartData = Extract<Part, { type: "text" }>;

export interface TextPartProps {
  part: TextPartData;
}

const TextPart: Component<TextPartProps> = (props) => (
  <div data-testid="text-part" class="whitespace-pre-wrap break-words text-sm leading-relaxed">
    {props.part.text}
  </div>
);

export default TextPart;
