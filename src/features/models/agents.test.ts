// L1 tests for the agent helpers (TASK-M5-04): the hidden filter, the
// color fallback, and the Tab-cycle step (wrap-around, unknown current
// name, empty list).

import { describe, expect, it } from "vitest";
import type { Agent } from "../../services/agent.js";
import {
  agentColor,
  cycleAgentName,
  DEFAULT_AGENT_COLOR,
  safeAgentColor,
  visibleAgents,
} from "./agents.js";

function agent(name: string, overrides: Partial<Agent> = {}): Agent {
  return { name, mode: "primary", permission: [], options: {}, ...overrides };
}

describe("visibleAgents", () => {
  it("filters hidden agents out and keeps the order", () => {
    const agents = [
      agent("build"),
      agent("plan", { hidden: true }),
      agent("debug", { mode: "subagent" }),
    ];
    expect(visibleAgents(agents).map((a) => a.name)).toEqual(["build", "debug"]);
  });

  it("treats a missing hidden flag as visible", () => {
    expect(visibleAgents([agent("build")]).map((a) => a.name)).toEqual(["build"]);
  });
});

describe("agentColor", () => {
  it("returns the agent color when present", () => {
    expect(agentColor(agent("build", { color: "#E5B83C" }))).toBe("#E5B83C");
  });

  it("falls back for a missing or empty color", () => {
    expect(agentColor(agent("build"))).toBe(DEFAULT_AGENT_COLOR);
    expect(agentColor(agent("build", { color: "" }))).toBe(DEFAULT_AGENT_COLOR);
    expect(agentColor(undefined)).toBe(DEFAULT_AGENT_COLOR);
  });
});

describe("safeAgentColor", () => {
  it("accepts plain hex colors with 3-8 digits", () => {
    expect(safeAgentColor("#E5B83C")).toBe("#E5B83C");
    expect(safeAgentColor("#abc")).toBe("#abc");
    expect(safeAgentColor("#abcd")).toBe("#abcd");
    expect(safeAgentColor("#11223344")).toBe("#11223344");
    expect(safeAgentColor("#ABCdef")).toBe("#ABCdef");
  });

  it("falls back for malformed, missing or injection-shaped colors", () => {
    expect(safeAgentColor(undefined)).toBe(DEFAULT_AGENT_COLOR);
    expect(safeAgentColor("")).toBe(DEFAULT_AGENT_COLOR);
    expect(safeAgentColor("red")).toBe(DEFAULT_AGENT_COLOR);
    expect(safeAgentColor("E5B83C")).toBe(DEFAULT_AGENT_COLOR);
    expect(safeAgentColor("#12")).toBe(DEFAULT_AGENT_COLOR);
    expect(safeAgentColor("#123456789")).toBe(DEFAULT_AGENT_COLOR);
    expect(safeAgentColor("#gggggg")).toBe(DEFAULT_AGENT_COLOR);
    expect(safeAgentColor("#E5B83C;background:url(javascript:x)")).toBe(DEFAULT_AGENT_COLOR);
  });
});

describe("cycleAgentName", () => {
  const agents = [
    agent("build", { color: "#E5B83C" }),
    agent("plan", { color: "#84C1FF" }),
    agent("architect", { hidden: true }),
  ];

  it("cycles through visible agents and wraps around", () => {
    expect(cycleAgentName(agents, "build")).toBe("plan");
    expect(cycleAgentName(agents, "plan")).toBe("build");
  });

  it("starts from the first visible agent for an unknown current name", () => {
    expect(cycleAgentName(agents, "architect")).toBe("build");
    expect(cycleAgentName(agents, null)).toBe("build");
    expect(cycleAgentName(agents, "nope")).toBe("build");
  });

  it("never returns a hidden agent", () => {
    const next = cycleAgentName(agents, "build");
    expect(next === "architect").toBe(false);
  });

  it("returns null when there is nothing to cycle to", () => {
    expect(cycleAgentName([], "build")).toBeNull();
    expect(cycleAgentName([agent("architect", { hidden: true })], "architect")).toBeNull();
  });
});
