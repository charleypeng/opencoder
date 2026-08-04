// L2 tests for the subtask card (TASK-M3-03): the header shows the prompt
// and the agent chip, collapsed by default; expanding reveals the
// description, model and command meta plus the M6 child-session placeholder
// note. The 1.18.11 SubtaskPart schema carries no status or child session
// id, so no status badge or navigation is rendered. The snapshot uses the
// all-parts fixture's subtask part (prt_p7).

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import SubtaskPart from "./SubtaskPart";
import type { SubtaskPartData } from "./SubtaskPart";
import allPartsFixtureJson from "../../../../tests/fixtures/message.stream.all-parts.json";

function subtaskPart(overrides: Partial<SubtaskPartData> = {}): SubtaskPartData {
  return {
    id: "prt_subtask",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "subtask",
    prompt: "Implement the auth API client",
    description: "Create the auth service and wire it into the login form",
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5" },
    ...overrides,
  };
}

describe("SubtaskPart", () => {
  it("renders the prompt and agent chip collapsed by default", () => {
    render(() => <SubtaskPart part={subtaskPart()} />);
    const toggle = screen.getByTestId("subtask-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("subtask-prompt")).toHaveTextContent("Implement the auth API client");
    expect(screen.getByTestId("agent-chip")).toHaveTextContent("build");
    expect(screen.queryByTestId("subtask-body")).not.toBeInTheDocument();
  });

  it("expands to show description, model and the M6 child-session note", () => {
    render(() => <SubtaskPart part={subtaskPart()} />);
    fireEvent.click(screen.getByTestId("subtask-toggle"));
    expect(screen.getByTestId("subtask-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("subtask-description")).toHaveTextContent(
      "Create the auth service and wire it into the login form",
    );
    expect(screen.getByTestId("subtask-model")).toHaveTextContent("openai/gpt-5");
    expect(screen.getByTestId("subtask-child-note")).toHaveTextContent("M6");

    fireEvent.click(screen.getByTestId("subtask-toggle"));
    expect(screen.queryByTestId("subtask-body")).not.toBeInTheDocument();
  });

  it("shows the command row when the part carries one", () => {
    render(() => <SubtaskPart part={subtaskPart({ command: "npm test" })} />);
    fireEvent.click(screen.getByTestId("subtask-toggle"));
    expect(screen.getByTestId("subtask-command")).toHaveTextContent("npm test");
  });

  it("omits the model row when the part carries no model", () => {
    render(() => <SubtaskPart part={subtaskPart({ model: undefined })} />);
    fireEvent.click(screen.getByTestId("subtask-toggle"));
    expect(screen.queryByTestId("subtask-model")).not.toBeInTheDocument();
  });
});

describe("SubtaskPart snapshot", () => {
  it("matches the fixture's subtask part", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p7") as
      SubtaskPartData | undefined;
    expect(fixturePart).toBeDefined();
    const { container } = render(() => <SubtaskPart part={fixturePart as SubtaskPartData} />);
    expect(container).toMatchSnapshot();
  });
});
