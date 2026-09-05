// L2 tests for the full tool card (TASK-M3-01): the four-state machine
// (pending / running / completed / error) with labels, shimmer and live
// duration, the per-tool renderers (bash terminal, edit diff, read/write
// code blocks, glob/grep lists, generic fallback), the copy button
// (clipboard mock), state transitions with interval cleanup, and one
// snapshot per tool card.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import ToolPart, { type ToolPartData, type ToolStatus } from "./ToolPart";

const { messageGetMock } = vi.hoisted(() => ({ messageGetMock: vi.fn() }));

vi.mock("../../../services/message.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/message.js")>();
  return { ...actual, createMessageService: vi.fn(() => ({ get: messageGetMock })) };
});

function toolPart(tool: string, state: Record<string, unknown>): ToolPartData {
  return {
    id: "prt_tool",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool,
    state: { input: {}, ...state },
  } as ToolPartData;
}

const bashPending = toolPart("bash", {
  status: "pending",
  input: { command: "ls src" },
  raw: "bash ls src",
});
const bashRunning = toolPart("bash", {
  status: "running",
  input: { command: "ls src" },
  time: { start: 1750000014000 },
});
const bashCompleted = toolPart("bash", {
  status: "completed",
  input: { command: "ls src" },
  output: "auth/\ncomponents/\n",
  title: "bash",
  metadata: {},
  time: { start: 1750000014000, end: 1750000017000 },
});
const bashFailed = toolPart("bash", {
  status: "error",
  input: { command: "npm test" },
  error: "npm: command not found",
  metadata: {},
  time: { start: 1000, end: 2000 },
});
const editCompleted = toolPart("edit", {
  status: "completed",
  input: {
    filePath: "src/auth/login.ts",
    oldString: "  return false;",
    newString: "  return true;",
  },
  output: "function login() {\n  return true;\n}",
  title: "edit",
  metadata: {},
  time: { start: 1000, end: 2000 },
});
const readCompleted = toolPart("read", {
  status: "completed",
  input: { filePath: "src/auth/session.ts" },
  output: "export const session = {\n  id: 'ses_1',\n};\n",
  title: "read",
  metadata: {},
  time: { start: 1000, end: 2000 },
});
const writeCompleted = toolPart("write", {
  status: "completed",
  input: { filePath: "src/auth/api.ts", content: "export const api = { login: () => {} };" },
  output: "export const api = { login: () => {} };",
  title: "write",
  metadata: {},
  time: { start: 1000, end: 2000 },
});
const globCompleted = toolPart("glob", {
  status: "completed",
  input: { pattern: "src/**/*.ts" },
  output: "src/auth/login.ts\nsrc/auth/session.ts\n",
  title: "glob",
  metadata: {},
  time: { start: 1000, end: 2000 },
});
const grepCompleted = toolPart("grep", {
  status: "completed",
  input: { pattern: "TODO", path: "src" },
  output: "src/auth/login.ts:12: // TODO: rate limit\n",
  title: "grep",
  metadata: {},
  time: { start: 1000, end: 2000 },
});
const unknownCompleted = toolPart("webFetch", {
  status: "completed",
  input: { url: "https://example.com" },
  output: "<title>Example</title>",
  title: "webFetch",
  metadata: {},
  time: { start: 1000, end: 2000 },
});

const STATUS_LABELS: Record<ToolStatus, string> = {
  pending: "Waiting: bash",
  running: "Running bash",
  completed: "bash completed",
  error: "bash failed",
};

function renderExpanded(part: ToolPartData) {
  render(() => <ToolPart part={part} />);
  fireEvent.click(screen.getByTestId("tool-toggle"));
}

afterEach(() => {
  vi.useRealTimers();
  messageGetMock.mockReset();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

describe("ToolPart", () => {
  it("renders a status icon, label and running shimmer per state", () => {
    for (const [status, part] of [
      ["pending", bashPending],
      ["running", bashRunning],
      ["completed", bashCompleted],
      ["error", bashFailed],
    ] as Array<[ToolStatus, ToolPartData]>) {
      const { unmount } = render(() => <ToolPart part={part} />);
      const card = screen.getByTestId("tool-part");
      expect(card).toHaveAttribute("data-status", status);
      expect(screen.getByTestId("tool-summary")).toHaveTextContent(
        status === "error" ? "Ran npm test" : "Ran ls src",
      );
      expect(screen.getByTestId("tool-status-label")).toHaveTextContent(STATUS_LABELS[status]);
      if (status === "running") {
        expect(screen.getByTestId("tool-shimmer")).toBeInTheDocument();
      } else {
        expect(screen.queryByTestId("tool-shimmer")).not.toBeInTheDocument();
      }
      unmount();
    }
  });

  it("is collapsed by default and expands to show the tool body", () => {
    render(() => <ToolPart part={bashCompleted} />);
    const toggle = screen.getByTestId("tool-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("tool-terminal")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("tool-terminal")).toBeInTheDocument();
  });

  it("does not surface the raw input JSON (hidden by design)", () => {
    renderExpanded(bashCompleted);
    expect(screen.queryByTestId("tool-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tool-input-toggle")).not.toBeInTheDocument();
  });

  it("renders the bash terminal with prompt, output and copy button", () => {
    renderExpanded(bashCompleted);
    const terminal = screen.getByTestId("tool-terminal");
    expect(terminal).toHaveTextContent("$ ls src");
    expect(terminal).toHaveTextContent("auth/");
    expect(terminal).toHaveTextContent("components/");
    expect(within(terminal).getByTestId("tool-copy")).toBeInTheDocument();
  });

  it("summarizes completed operations from their input while retaining the success state", () => {
    render(() => <ToolPart part={readCompleted} />);

    expect(screen.getByTestId("tool-summary")).toHaveTextContent("Read src/auth/session.ts");
    expect(screen.getByTestId("tool-part")).toHaveAttribute("data-status", "completed");
    expect(screen.getByTestId("tool-toggle")).not.toHaveClass("overflow-hidden");
    expect(screen.getByTestId("tool-summary")).not.toHaveClass("truncate");
  });

  it("summarizes questions from their first question heading", () => {
    const questionCompleted = toolPart("question", {
      status: "completed",
      input: { questions: [{ header: "Continue with the migration?" }] },
      output: "answered",
      title: "question",
      metadata: {},
      time: { start: 1000, end: 2000 },
    });

    render(() => <ToolPart part={questionCompleted} />);
    expect(screen.getByTestId("tool-summary")).toHaveTextContent(
      "Asked Continue with the migration?",
    );
  });

  it("shows the bash exit code from tool metadata", () => {
    const failedTest = toolPart("bash", {
      status: "completed",
      input: { command: "npm test" },
      output: "1 failing\n",
      title: "bash",
      metadata: { exitCode: 1 },
      time: { start: 1000, end: 2000 },
    });
    renderExpanded(failedTest);
    expect(screen.getByTestId("tool-terminal")).toHaveTextContent("exit 1");
  });

  it("renders the edit inline diff preview with additions and removals", () => {
    renderExpanded(editCompleted);
    const diff = screen.getByTestId("tool-diff");
    expect(diff).toHaveTextContent("src/auth/login.ts");
    expect(diff.textContent).toMatch(/-\s+return false;/);
    expect(diff.textContent).toMatch(/\+\s+return true;/);
    expect(within(diff).getByTestId("tool-copy")).toBeInTheDocument();
  });

  it("refreshes missing edit details from the message endpoint when expanded", async () => {
    messageGetMock.mockResolvedValue({
      info: {},
      parts: [
        {
          ...editCompleted,
          state: {
            ...editCompleted.state,
            input: {
              filePath: "src/auth/login.ts",
              oldString: "remote old title",
              newString: "remote new title",
            },
          },
        },
      ],
    });
    const incomplete = toolPart("edit", {
      status: "completed",
      input: { filePath: "src/auth/login.ts" },
      output: "Edit applied successfully.",
      title: "edit",
      metadata: {},
      time: { start: 1000, end: 2000 },
    });

    render(() => <ToolPart part={incomplete} />);
    fireEvent.click(screen.getByTestId("tool-toggle"));

    await waitFor(() =>
      expect(screen.getByTestId("tool-diff")).toHaveTextContent("remote new title"),
    );
    expect(messageGetMock).toHaveBeenCalledWith("sess_1", "msg_1");
  });

  it("renders read and write code blocks with their file paths", () => {
    const first = render(() => <ToolPart part={readCompleted} />);
    fireEvent.click(screen.getByTestId("tool-toggle"));
    const read = screen.getByTestId("tool-code");
    expect(read).toHaveTextContent("src/auth/session.ts");
    expect(read).toHaveTextContent("export const session = {");
    first.unmount();

    render(() => <ToolPart part={writeCompleted} />);
    fireEvent.click(screen.getByTestId("tool-toggle"));
    const write = screen.getByTestId("tool-code");
    expect(write).toHaveTextContent("src/auth/api.ts");
    expect(write).toHaveTextContent("export const api =");
  });

  it("renders glob and grep result lists with count badges", () => {
    const first = render(() => <ToolPart part={globCompleted} />);
    fireEvent.click(screen.getByTestId("tool-toggle"));
    const glob = screen.getByTestId("tool-list");
    expect(glob).toHaveTextContent("src/**/*.ts");
    expect(glob).toHaveTextContent("2 files");
    expect(glob).toHaveTextContent("src/auth/login.ts");
    first.unmount();

    render(() => <ToolPart part={grepCompleted} />);
    fireEvent.click(screen.getByTestId("tool-toggle"));
    const grep = screen.getByTestId("tool-list");
    expect(grep).toHaveTextContent("TODO");
    expect(grep).toHaveTextContent("1 match");
    expect(grep).toHaveTextContent("src/auth/login.ts:12");
  });

  it("falls back to the generic card for unknown tools", () => {
    renderExpanded(unknownCompleted);
    expect(screen.getByTestId("tool-generic")).toHaveTextContent("<title>Example</title>");
    expect(screen.getByTestId("tool-summary")).toHaveTextContent("Used webFetch");
  });

  it("shows the error message for failed calls", () => {
    renderExpanded(bashFailed);
    expect(screen.getByTestId("tool-error")).toHaveTextContent("npm: command not found");
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });

  it("shows measured or metadata durations for completed calls", () => {
    const first = render(() => <ToolPart part={bashCompleted} />);
    expect(screen.getByTestId("tool-duration")).toHaveTextContent("3s");
    first.unmount();

    const withMetadata = toolPart("read", {
      status: "completed",
      input: { filePath: "a.ts" },
      output: "x",
      title: "read",
      metadata: { duration: "420ms" },
      time: { start: 1000, end: 2000 },
    });
    render(() => <ToolPart part={withMetadata} />);
    expect(screen.getByTestId("tool-duration")).toHaveTextContent("420ms");
  });

  it("ticks the elapsed time while running and cleans up the interval", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1750000014000));
      render(() => <ToolPart part={bashRunning} />);
      expect(screen.getByTestId("tool-duration")).toHaveTextContent("0ms");

      vi.advanceTimersByTime(1250);
      expect(screen.getByTestId("tool-duration")).toHaveTextContent("1.3s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-renders across pending → running → completed transitions", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1750000014000));
      const [part, setPart] = createSignal<ToolPartData>(bashPending);
      render(() => <ToolPart part={part()} />);

      expect(screen.getByTestId("tool-part")).toHaveAttribute("data-status", "pending");
      expect(screen.getByTestId("tool-status-label")).toHaveTextContent("Waiting: bash");
      expect(screen.queryByTestId("tool-shimmer")).not.toBeInTheDocument();
      expect(screen.queryByTestId("tool-duration")).not.toBeInTheDocument();

      setPart(bashRunning);
      expect(screen.getByTestId("tool-part")).toHaveAttribute("data-status", "running");
      expect(screen.getByTestId("tool-status-label")).toHaveTextContent("Running bash");
      expect(screen.getByTestId("tool-shimmer")).toBeInTheDocument();

      vi.advanceTimersByTime(1250);
      expect(screen.getByTestId("tool-duration")).toHaveTextContent("1.3s");

      setPart(bashCompleted);
      expect(screen.getByTestId("tool-part")).toHaveAttribute("data-status", "completed");
      expect(screen.queryByTestId("tool-shimmer")).not.toBeInTheDocument();
      expect(screen.getByTestId("tool-duration")).toHaveTextContent("3s");

      // The running clock was cleaned up: advancing timers no longer
      // changes the completed duration.
      vi.advanceTimersByTime(10000);
      expect(screen.getByTestId("tool-duration")).toHaveTextContent("3s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies output to the clipboard with feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderExpanded(bashCompleted);
    fireEvent.click(screen.getByTestId("tool-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("auth/\ncomponents/\n"));
    await waitFor(() => expect(screen.getByTestId("tool-copy")).toHaveTextContent("Copied!"));
  });
});

const SNAPSHOT_PARTS: Array<[string, ToolPartData]> = [
  ["bash", bashCompleted],
  ["edit", editCompleted],
  ["read", readCompleted],
  ["write", writeCompleted],
  ["glob", globCompleted],
  ["grep", grepCompleted],
];

describe.each(SNAPSHOT_PARTS)("ToolPart snapshot: %s", (_name, part) => {
  it("matches the expanded card", () => {
    const { container } = render(() => <ToolPart part={part} />);
    fireEvent.click(screen.getByTestId("tool-toggle"));
    expect(container).toMatchSnapshot();
  });
});
