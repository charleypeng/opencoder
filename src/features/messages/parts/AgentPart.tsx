// Agent mention chip (TASK-M3-03): an inline accent chip with a robot icon
// and the agent name. AgentPart renders a mention from the transcript
// (keeping the mention source as a tooltip when the part carries one);
// AgentChip is the shared visual reused by SubtaskPart's header. No color
// mapping per agent exists in the contract, so every chip uses the accent
// tone.

import type { Component } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { ContentIcon } from "./icons.js";

export type AgentPartData = Extract<Part, { type: "agent" }>;

export interface AgentPartProps {
  part: AgentPartData;
}

export interface AgentChipProps {
  name: string;
}

export function AgentChip(props: AgentChipProps) {
  return (
    <span
      data-testid="agent-chip"
      class="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-1.5 py-px text-[10px] font-medium text-accent"
    >
      <ContentIcon kind="agent" />
      <span data-testid="agent-chip-name">{props.name}</span>
    </span>
  );
}

const AgentPart: Component<AgentPartProps> = (props) => {
  const source = () => props.part.source?.value;

  return (
    <span
      data-testid="agent-part"
      class="my-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
      title={source() !== undefined ? `Mentioned: ${source()}` : undefined}
    >
      <ContentIcon kind="agent" />
      <span data-testid="agent-name">{props.part.name}</span>
    </span>
  );
};

export default AgentPart;
