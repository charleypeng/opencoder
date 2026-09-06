// Reasoning part renderer (chat refactor): renders the part's reasoning text
// as a plain block. The fold/expand behavior (collapsed by default,
// auto-expand while streaming) moved UP to the ProcessFold container that
// groups every process part of a message below the answer — a per-part fold
// inside the group fold would double up the chrome. No state tracking is
// needed: the part renders whatever text the store holds, so streamed deltas
// keep updating the block in place (M2-09).

import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";

export type ReasoningPartData = Extract<Part, { type: "reasoning" }>;

export interface ReasoningPartProps {
  part: ReasoningPartData;
}

const ReasoningPart: Component<ReasoningPartProps> = (props) => (
  <div data-testid="reasoning-part" class="my-1 min-w-0 rounded-md bg-bg-sunken/50 px-2 py-2">
    <div
      data-testid="reasoning-body"
      class="whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-secondary"
    >
      {props.part.text}
    </div>
  </div>
);

export default ReasoningPart;
