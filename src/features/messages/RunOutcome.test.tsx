import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import type { Part } from "../../stores/messages.js";
import RunOutcome from "./RunOutcome.js";

function tool(tool: string, input: Record<string, unknown>, callID: string): Part {
  return {
    id: `part-${callID}`,
    sessionID: "session-1",
    messageID: "assistant-1",
    type: "tool",
    callID,
    tool,
    state: {
      status: "completed",
      input,
      output: "ok",
      title: tool,
      metadata: {},
      time: { start: 1, end: 2 },
    },
  } as Part;
}

describe("RunOutcome", () => {
  it("shows compact file and command summaries that expand on demand", () => {
    render(() => (
      <RunOutcome
        parts={[
          tool("edit", { filePath: "src/chat.tsx" }, "edit"),
          tool("bash", { command: "pnpm test" }, "test"),
        ]}
        diffs={[
          {
            file: "src/chat.tsx",
            additions: 12,
            deletions: 3,
            status: "modified",
            patch: "@@ -1,1 +1,1 @@\n-old chat\n+new chat",
          },
        ]}
        messageID="user-1"
      />
    ));

    expect(screen.getByTestId("run-outcome")).toBeInTheDocument();
    expect(screen.getByTestId("run-files-toggle")).toHaveTextContent("1 changed file");
    expect(screen.getByTestId("run-files-toggle")).toHaveTextContent("+12");
    expect(screen.getByTestId("run-files-toggle")).toHaveTextContent("−3");
    expect(screen.getByTestId("run-commands-toggle")).toHaveTextContent("1 command");
    expect(screen.queryByText("src/chat.tsx")).not.toBeInTheDocument();
    expect(screen.queryByText("pnpm test")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("run-files-toggle"));
    fireEvent.click(screen.getByTestId("run-commands-toggle"));
    expect(screen.getByText("src/chat.tsx")).toBeInTheDocument();
    expect(screen.getByTestId("diff-unified")).toHaveTextContent("new chat");
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
  });

  it("opens the run diff from the originating user message", () => {
    let opened = "";
    render(() => (
      <RunOutcome
        parts={[tool("write", { path: "src/new.ts" }, "write")]}
        messageID="user-42"
        onViewDiff={(messageID) => {
          opened = messageID;
        }}
      />
    ));

    fireEvent.click(screen.getByTestId("run-view-diff"));
    expect(opened).toBe("user-42");
  });

  it("prefers the workspace review handler when one is available", () => {
    let opened = "";
    render(() => (
      <RunOutcome
        parts={[tool("write", { path: "src/new.ts" }, "write")]}
        messageID="user-42"
        onViewDiff={() => {
          throw new Error("The main diff view should not open");
        }}
        onViewDiffInTools={(messageID) => {
          opened = messageID;
        }}
      />
    ));

    fireEvent.click(screen.getByTestId("run-view-diff"));
    expect(opened).toBe("user-42");
  });

  it("renders nothing when the run changed no files and ran no commands", () => {
    render(() => <RunOutcome parts={[]} messageID="user-1" />);
    expect(screen.queryByTestId("run-outcome")).not.toBeInTheDocument();
  });
});
