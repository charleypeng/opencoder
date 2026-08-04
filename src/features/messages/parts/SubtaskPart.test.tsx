// L2 tests for the subtask card (TASK-M3-03, TASK-M6-07): the header shows
// the prompt and the agent chip, collapsed by default; expanding reveals the
// description, model and command meta plus the "Open child session" button
// (only while an onOpenChild callback is provided — the 1.18.11 SubtaskPart
// schema carries no child session id, so the wired handler targets the first
// child of the part's session; without a callback no button renders). The
// snapshot uses the all-parts fixture's subtask part (prt_p7).

import { describe, expect, it, vi } from "vitest";
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

  it("expands to show description and model; no child button without a callback", () => {
    render(() => <SubtaskPart part={subtaskPart()} />);
    fireEvent.click(screen.getByTestId("subtask-toggle"));
    expect(screen.getByTestId("subtask-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("subtask-description")).toHaveTextContent(
      "Create the auth service and wire it into the login form",
    );
    expect(screen.getByTestId("subtask-model")).toHaveTextContent("openai/gpt-5");
    expect(screen.queryByTestId("subtask-open-child")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("subtask-toggle"));
    expect(screen.queryByTestId("subtask-body")).not.toBeInTheDocument();
  });

  it("shows the open-child button and calls onOpenChild on click (TASK-M6-07)", () => {
    const opened = vi.fn();
    render(() => <SubtaskPart part={subtaskPart()} onOpenChild={opened} />);
    fireEvent.click(screen.getByTestId("subtask-toggle"));
    fireEvent.click(screen.getByTestId("subtask-open-child"));
    expect(opened).toHaveBeenCalledTimes(1);
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
