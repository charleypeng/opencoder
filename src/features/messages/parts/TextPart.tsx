// Text part renderer (TASK-M2-07): renders the part's text as markdown
// (GFM + Shiki-highlighted code blocks); plain pre-wrap was the M2-06
// placeholder until markdown rendering landed.

import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import MarkdownText from "../markdown/MarkdownText.js";

export type TextPartData = Extract<Part, { type: "text" }>;

export interface TextPartProps {
  part: TextPartData;
}

const TextPart: Component<TextPartProps> = (props) => (
  <div data-testid="text-part">
    <MarkdownText text={props.part.text} />
  </div>
);

export default TextPart;
