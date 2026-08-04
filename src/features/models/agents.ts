// Pure agent-list helpers (TASK-M5-04): the visible (non-hidden) filter,
// the color normalization for the chip/menu dots, and the Tab-cycle
// step that walks the visible agents in order.

import type { Agent } from "../../services/agent.js";

/** Fallback dot color when an agent declares no usable color. */
export const DEFAULT_AGENT_COLOR = "#9ca3af";

/** Agents the user can pick (hidden agents are filtered out). */
export function visibleAgents(agents: readonly Agent[]): Agent[] {
  return agents.filter((agent) => agent.hidden !== true);
}

/** Normalizes an agent's color for rendering; falls back when missing. */
export function agentColor(agent: Agent | undefined): string {
  const color = agent?.color;
  return color === undefined || color === "" ? DEFAULT_AGENT_COLOR : color;
}

/**
 * The next visible agent after the current one (wrapping); the first
 * visible agent when the current one is unknown, or null when there is
 * nothing to cycle to.
 */
export function cycleAgentName(agents: readonly Agent[], current: string | null): string | null {
  const visible = visibleAgents(agents);
  if (visible.length === 0) return null;
  const index = visible.findIndex((agent) => agent.name === current);
  if (index === -1) return visible[0].name;
  return visible[(index + 1) % visible.length].name;
}
