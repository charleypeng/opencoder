// L2 tests for the tool card (TASK-M2-06, v1): per-state icons and labels
// (pending / running / completed / error), collapsed by default, and the
// expanded input (pretty JSON), output and error sections.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import ToolPart, { type ToolPartData, type ToolStatus } from "./ToolPart";

function toolPart(status: ToolStatus, extra: Record<string, unknown> = {}): ToolPartData {
  return {
    id: "prt_tool",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state: { status, input: {}, time: { start: 1 }, ...extra },
  } as ToolPartData;
}

const STATUS_LABELS: Record<ToolStatus, string> = {
  pending: "Pending",
  running: "Running…",
  completed: "Completed",
  error: "Failed",
};

describe("ToolPart", () => {
  it("renders the tool name with a status icon and label per state", () => {
    for (const status of ["pending", "running", "completed", "error"] as ToolStatus[]) {
      const { unmount } = render(() => <ToolPart part={toolPart(status)} />);
      const card = screen.getByTestId("tool-part");
      expect(card).toHaveAttribute("data-status", status);
      expect(screen.getByText("bash")).toBeInTheDocument();
      expect(screen.getByTestId("tool-status-label")).toHaveTextContent(STATUS_LABELS[status]);
      unmount();
    }
  });

  it("is collapsed by default and expands to show the input as pretty JSON", () => {
    render(() => <ToolPart part={toolPart("running", { input: { command: "ls src" } })} />);
    const toggle = screen.getByTestId("tool-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/ls src/)).toBeInTheDocument();
  });

  it("shows the output section for completed tools", () => {
    render(() => (
      <ToolPart
        part={toolPart("completed", {
          input: { command: "ls src" },
          output: "auth/\ncomponents/",
          title: "bash",
          metadata: {},
          time: { start: 1, end: 2 },
        })}
      />
    ));
    fireEvent.click(screen.getByTestId("tool-toggle"));
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText(/auth/)).toBeInTheDocument();
    expect(screen.getByText(/components/)).toBeInTheDocument();
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("shows the error section for failed tools", () => {
    render(() => (
      <ToolPart
        part={toolPart("error", {
          input: { command: "ls src" },
          error: "command not found",
          time: { start: 1, end: 2 },
        })}
      />
    ));
    fireEvent.click(screen.getByTestId("tool-toggle"));
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("command not found")).toBeInTheDocument();
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });
});
