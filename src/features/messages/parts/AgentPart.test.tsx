// L2 tests for the agent mention chip (TASK-M3-03): the inline accent chip
// with robot icon and agent name, plus the mention-source tooltip when the
// part carries one. The snapshot uses the agent part added to the all-parts
// fixture (prt_p21).

import { describe, expect, it } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import AgentPart from "./AgentPart";
import type { AgentPartData } from "./AgentPart";
import allPartsFixtureJson from "../../../../tests/fixtures/message.stream.all-parts.json";

function agentPart(overrides: Partial<AgentPartData> = {}): AgentPartData {
  return {
    id: "prt_agent",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "agent",
    name: "build",
    ...overrides,
  };
}

describe("AgentPart", () => {
  it("renders the accent chip with the agent name", () => {
    render(() => <AgentPart part={agentPart()} />);
    const chip = screen.getByTestId("agent-part");
    expect(chip).toHaveTextContent("build");
  });

  it("keeps the mention source as a tooltip when present", () => {
    render(() => <AgentPart part={agentPart({ source: { value: "@build", start: 0, end: 6 } })} />);
    expect(screen.getByTestId("agent-part")).toHaveAttribute(
      "title",
      expect.stringContaining("@build"),
    );
  });
});

describe("AgentPart snapshot", () => {
  it("matches the fixture's agent part", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p21") as
      AgentPartData | undefined;
    expect(fixturePart).toBeDefined();
    const { container } = render(() => <AgentPart part={fixturePart as AgentPartData} />);
    expect(container).toMatchSnapshot();
  });
});
