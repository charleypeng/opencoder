// L1 tests for the agent store (TASK-M5-04): catalog replacement + loaded
// flag, per-session selection, the resolution fallback chain (selection ->
// session agent -> first visible), hidden filtering and per-server reset.

import { beforeEach, describe, expect, it } from "vitest";
import type { Agent } from "../services/agent.js";
import {
  agentNameFor,
  agentStates,
  clearSession,
  getServerAgentState,
  resetServer,
  setAgentForSession,
  setAgents,
} from "./agents.js";

const SERVER = "srv-agents";

function agent(name: string, overrides: Partial<Agent> = {}): Agent {
  return { name, mode: "primary", permission: [], options: {}, ...overrides };
}

const CATALOG = [
  agent("build", { color: "#E5B83C" }),
  agent("plan", { color: "#84C1FF" }),
  agent("architect", { hidden: true, mode: "subagent" }),
];

beforeEach(() => {
  resetServer(SERVER);
});

describe("setAgents", () => {
  it("replaces the catalog and marks the server loaded", () => {
    setAgents(SERVER, CATALOG);

    const state = getServerAgentState(SERVER);
    expect(state.loaded).toBe(true);
    expect(state.agents).toHaveLength(3);
    expect(agentStates[SERVER]).toEqual(state);
  });

  it("resets when a fresh server is touched", () => {
    expect(getServerAgentState(SERVER).loaded).toBe(false);
    expect(getServerAgentState(SERVER).agents).toEqual([]);
  });

  it("replacement keeps existing per-session selections", () => {
    setAgents(SERVER, CATALOG);
    setAgentForSession(SERVER, "ses_1", "plan");
    setAgents(SERVER, [agent("plan")]);

    expect(agentNameFor(SERVER, "ses_1")).toBe("plan");
  });
});

describe("agentNameFor", () => {
  it("defaults to the first visible agent", () => {
    setAgents(SERVER, CATALOG);
    expect(agentNameFor(SERVER, "ses_1")).toBe("build");
  });

  it("prefers the per-session selection once recorded", () => {
    setAgents(SERVER, CATALOG);
    setAgentForSession(SERVER, "ses_1", "plan");
    expect(agentNameFor(SERVER, "ses_1")).toBe("plan");
    expect(agentNameFor(SERVER, "ses_2")).toBe("build");
  });

  it("falls back to the session's own agent when visible", () => {
    setAgents(SERVER, CATALOG);
    expect(agentNameFor(SERVER, "ses_1", "plan")).toBe("plan");
  });

  it("never resolves to a hidden agent", () => {
    setAgents(SERVER, CATALOG);
    expect(agentNameFor(SERVER, "ses_1", "architect")).toBe("build");
  });

  it("drops a selection that vanished from the catalog", () => {
    setAgents(SERVER, CATALOG);
    setAgentForSession(SERVER, "ses_1", "plan");
    setAgents(SERVER, [agent("build"), agent("architect", { hidden: true })]);
    expect(agentNameFor(SERVER, "ses_1")).toBe("build");
  });

  it("returns null without any usable agent", () => {
    expect(agentNameFor(SERVER, "ses_1")).toBeNull();
    setAgents(SERVER, [agent("architect", { hidden: true })]);
    expect(agentNameFor(SERVER, "ses_1")).toBeNull();
  });
});

describe("resetServer", () => {
  it("drops the whole server bucket", () => {
    setAgents(SERVER, CATALOG);
    setAgentForSession(SERVER, "ses_1", "plan");
    resetServer(SERVER);

    expect(getServerAgentState(SERVER)).toEqual({
      agents: [],
      loaded: false,
      activeBySession: {},
    });
    expect(agentStates[SERVER]).toBeUndefined();
  });
});

describe("clearSession", () => {
  it("drops the recorded choice for one session", () => {
    setAgents(SERVER, CATALOG);
    setAgentForSession(SERVER, "ses_1", "plan");
    clearSession(SERVER, "ses_1");

    expect(getServerAgentState(SERVER).activeBySession["ses_1"]).toBeUndefined();
    // The resolution falls back to the first visible agent.
    expect(agentNameFor(SERVER, "ses_1")).toBe("build");
  });

  it("leaves other sessions and unknown buckets untouched", () => {
    setAgents(SERVER, CATALOG);
    setAgentForSession(SERVER, "ses_1", "plan");
    setAgentForSession(SERVER, "ses_2", "build");
    clearSession(SERVER, "ses_nope");
    clearSession(SERVER + "-other", "ses_1");

    expect(agentNameFor(SERVER, "ses_1")).toBe("plan");
    expect(agentNameFor(SERVER, "ses_2")).toBe("build");
  });
});
