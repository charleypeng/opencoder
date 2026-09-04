import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { ApiClient, type Transport } from "../../services/client.js";
import type { Part } from "../../stores/messages.js";
import RunOutcome from "./RunOutcome.js";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/client.js")>();
  return { ...actual, getApiClient: getApiClientMock };
});

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

function patch(files: string[], messageID = "assistant-1"): Part {
  return {
    id: "patch-1",
    sessionID: "session-1",
    messageID,
    type: "patch",
    hash: "abc",
    files,
  } as Part;
}

beforeEach(() => {
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue(new ApiClient({ request: vi.fn() }));
});

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
    expect(screen.queryByTestId("diff-unified")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("run-diff-file"));
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

  it("loads patch content for the completed run instead of treating summary stats as empty", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: [
        {
          file: "README.md",
          patch: "@@ -1 +1 @@\n-old title\n+new title",
          additions: 1,
          deletions: 1,
          status: "modified",
        },
      ],
      bodyText: undefined,
    }));
    getApiClientMock.mockReturnValue(
      new ApiClient({ request: request as unknown as Transport["request"] }),
    );
    render(() => (
      <RunOutcome
        parts={[patch(["/Volumes/Doc/dev/codewalk/README.md"])]}
        diffs={[{ file: "README.md", additions: 1, deletions: 1, status: "modified" }]}
        sessionID="session-1"
        messageID="user-1"
      />
    ));

    fireEvent.click(screen.getByTestId("run-files-toggle"));
    expect(screen.getByTestId("run-diff-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("run-diff-file")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("run-diff-file"));
    expect(screen.getByTestId("diff-unified")).toHaveTextContent("new title");
    expect(screen.queryByTestId("diff-file-no-content")).not.toBeInTheDocument();
  });

  it("reveals only the selected file's diff when a run changes multiple files", () => {
    render(() => (
      <RunOutcome
        parts={[tool("edit", { filePath: "src/first.ts" }, "first")]}
        diffs={[
          {
            file: "src/first.ts",
            patch: "@@ -1 +1 @@\n-old first\n+new first",
            additions: 1,
            deletions: 1,
          },
          {
            file: "src/second.ts",
            patch: "@@ -1 +1 @@\n-old second\n+new second",
            additions: 1,
            deletions: 1,
          },
        ]}
        messageID="user-1"
      />
    ));

    fireEvent.click(screen.getByTestId("run-files-toggle"));
    const files = screen.getAllByTestId("run-diff-file");
    expect(files).toHaveLength(2);
    expect(screen.queryByTestId("diff-unified")).not.toBeInTheDocument();

    fireEvent.click(files[1]);
    expect(screen.getByTestId("diff-unified")).toHaveTextContent("new second");
    expect(screen.getAllByTestId("diff-file")).toHaveLength(1);

    fireEvent.click(files[0]);
    expect(screen.getByTestId("diff-unified")).toHaveTextContent("new first");
    expect(screen.getAllByTestId("diff-file")).toHaveLength(1);
  });

  it("renders nothing when the run changed no files and ran no commands", () => {
    render(() => <RunOutcome parts={[]} messageID="user-1" />);
    expect(screen.queryByTestId("run-outcome")).not.toBeInTheDocument();
  });
});
