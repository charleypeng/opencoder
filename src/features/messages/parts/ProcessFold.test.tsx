import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import ProcessFold from "./ProcessFold";
import type { Part } from "../../../stores/messages";
import { clearActivityViewState } from "../activity/activityViewState";

function reasoningPart(text: string, id = "prt_reasoning", end: number | null = 2): Part {
  return {
    id,
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "reasoning",
    text,
    time: { start: 1, ...(end === null ? {} : { end }) },
  };
}

function toolPart(
  tool: string,
  status: "completed" | "error" | "running" | "pending",
  id = "prt_tool",
  input: Record<string, unknown> = { command: "git status --short" },
): Part {
  const base = {
    id,
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "tool" as const,
    callID: `call_${id}`,
    tool,
  };
  if (status === "completed") {
    return {
      ...base,
      state: {
        status,
        input: input as never,
        output: "clean",
        title: tool,
        metadata: {},
        time: { start: 1, end: 2 },
      },
    };
  }
  if (status === "error") {
    return {
      ...base,
      state: { status, input: input as never, error: "boom", time: { start: 1, end: 2 } },
    };
  }
  if (status === "running")
    return { ...base, state: { status, input: input as never, time: { start: 1 } } };
  return { ...base, state: { status, input: input as never, raw: "{}" } };
}

function retryPart(): Part {
  return {
    id: "prt_retry",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "retry",
    error: { data: { message: "rate limited" } },
    time: { created: 10 },
  } as Part;
}

function progressText(text = "I found the message renderer and am checking its event flow."): Part {
  return {
    id: "prt_progress",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "text",
    text,
    time: { start: 3, end: 4 },
  };
}

describe("ProcessFold", () => {
  beforeEach(() => clearActivityViewState());
  afterEach(() => vi.useRealTimers());

  it("keeps completed history compact until the user opens it", () => {
    render(() => (
      <ProcessFold parts={[progressText(), toolPart("bash", "completed")]} runKey="history" />
    ));

    const toggle = screen.getByTestId("process-fold-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("process-fold-body")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(toggle);
    expect(screen.getByTestId("text-part")).toHaveTextContent("I found the message renderer");
    expect(screen.getByTestId("tool-summary")).toHaveTextContent("Ran git status --short");
  });

  it("opens a live run while keeping thoughts and tool details independently collapsed", () => {
    render(() => (
      <ProcessFold
        active
        runKey="live"
        parts={[
          progressText(),
          reasoningPart("planning the change", "prt_reasoning", null),
          toolPart("bash", "completed"),
        ]}
      />
    ));

    expect(screen.getByTestId("process-fold-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("text-part")).toHaveTextContent("I found the message renderer");
    expect(screen.queryByTestId("reasoning-body")).not.toBeInTheDocument();
    expect(screen.getByTestId("tool-toggle")).toHaveAttribute("aria-expanded", "false");
    // The active reasoning preview becomes the tail status; the original text
    // stays behind the single quiet thought-details disclosure.
    expect(screen.getByTestId("process-tail-status")).toHaveTextContent("planning the change");

    fireEvent.click(screen.getByTestId("thought-details-toggle"));
    expect(screen.getByTestId("reasoning-body")).toHaveTextContent("planning the change");

    fireEvent.click(screen.getByTestId("tool-toggle"));
    expect(screen.getByTestId("tool-summary")).toHaveTextContent("Ran command");
    expect(screen.getByTestId("tool-terminal")).toHaveTextContent("$ git status --short");
  });

  it("renders progress, tool rows, and the thought details entry in source order", () => {
    render(() => (
      <ProcessFold
        active
        parts={[
          progressText("first update"),
          reasoningPart("considering options"),
          toolPart("bash", "completed"),
        ]}
      />
    ));

    const progress = screen.getByText("first update");
    const tool = screen.getByTestId("tool-part");
    const thought = screen.getByTestId("thought-details-toggle");
    expect(progress.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The quiet thought-details entry trails the reading flow, before the
    // single tail status slot.
    expect(thought.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("shows exactly one visible tail status while active", () => {
    render(() => (
      <ProcessFold
        active
        runKey="tail"
        parts={[progressText(), reasoningPart("planning the change", "prt_reasoning", null)]}
      />
    ));
    expect(screen.getAllByTestId("process-tail-status")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("process-fold-toggle"));
    expect(screen.getAllByTestId("process-tail-status")).toHaveLength(1);
  });

  it("keeps the tail status quiet while only the answer text is streaming", () => {
    render(() => (
      <ProcessFold
        active
        contentStreaming
        runKey="text-stream"
        parts={[toolPart("bash", "completed")]}
      />
    ));
    expect(screen.queryByTestId("process-tail-status")).not.toBeInTheDocument();
  });

  it("marks moving work as sweep-eligible and attention states as solid", () => {
    const { unmount } = render(() => (
      <ProcessFold active runKey="sweep" parts={[toolPart("bash", "running")]} />
    ));
    expect(screen.getByTestId("process-tail-status")).toHaveAttribute("data-animated", "true");
    unmount();

    render(() => <ProcessFold active runKey="sweep-retry" parts={[retryPart()]} />);
    expect(screen.getByTestId("process-tail-status")).toHaveAttribute("data-animated", "false");
  });

  it("shows a solid waiting-for-user status instead of a model guess", () => {
    render(() => <ProcessFold active waitingUser="permission" runKey="wait-user" parts={[]} />);
    const tail = screen.getByTestId("process-tail-status");
    expect(tail).toHaveAttribute("data-kind", "waiting-user");
    expect(tail).toHaveAttribute("data-animated", "false");
    expect(tail).toHaveTextContent("Waiting for your approval");
    expect(screen.getByTestId("process-fold-status")).toHaveTextContent(
      "Waiting for your approval",
    );
  });

  it("reports an authoritative stop instead of a completed duration", () => {
    render(() => (
      <ProcessFold
        parts={[toolPart("bash", "completed")]}
        startedAt={1000}
        completedAt={61000}
        stopped
        runKey="stopped-run"
      />
    ));
    expect(screen.getByTestId("process-fold-status")).toHaveTextContent("Stopped");
    expect(screen.getByTestId("process-fold")).toHaveAttribute("data-status", "stopped");
  });

  it("labels an active retry as retrying and a finished one as attention", () => {
    const live = render(() => <ProcessFold active parts={[retryPart()]} runKey="retry-live" />);
    expect(live.getByTestId("process-fold-status")).toHaveTextContent("Retrying");
    live.unmount();

    const done = render(() => <ProcessFold parts={[retryPart()]} runKey="retry-done" />);
    expect(done.getByTestId("process-fold-status")).toHaveTextContent("attention");
  });

  it("stops the sweep when the run finishes", async () => {
    const [active, setActive] = createSignal(true);
    render(() => (
      <ProcessFold active={active()} runKey="finish" parts={[toolPart("bash", "running")]} />
    ));
    expect(screen.getByTestId("process-tail-status")).toBeInTheDocument();

    setActive(false);
    await Promise.resolve();
    expect(screen.queryByTestId("process-tail-status")).not.toBeInTheDocument();
  });

  it("restores thought and tool disclosures after an unmount", () => {
    const props = {
      active: true,
      runKey: "server:session:live",
      parts: [reasoningPart("thinking"), toolPart("bash", "completed")],
    };
    const first = render(() => <ProcessFold {...props} />);
    fireEvent.click(screen.getByTestId("thought-details-toggle"));
    fireEvent.click(screen.getByTestId("tool-toggle"));
    first.unmount();

    render(() => <ProcessFold {...props} />);
    expect(screen.getByTestId("reasoning-body")).toHaveTextContent("thinking");
    expect(screen.getByTestId("tool-toggle")).toHaveAttribute("aria-expanded", "true");
  });

  it("does not reset a manual top-level choice while streaming state changes", async () => {
    const [active, setActive] = createSignal(true);
    render(() => (
      <ProcessFold parts={[reasoningPart("thinking", "prt_reasoning", null)]} active={active()} />
    ));
    const toggle = screen.getByTestId("process-fold-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    setActive(false);
    await Promise.resolve();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a ticking waiting status before the first event", () => {
    vi.useFakeTimers();
    vi.setSystemTime(3000);
    render(() => <ProcessFold parts={[]} active startedAt={1000} runKey="waiting-run" />);

    expect(screen.getByTestId("process-fold-toggle")).toBeDisabled();
    expect(screen.getByTestId("process-fold-status")).toHaveTextContent("Processing for 2s");
    vi.advanceTimersByTime(2000);
    expect(screen.getByTestId("process-fold-status")).toHaveTextContent("Processing for 4s");
  });

  it("reports the completed run duration without reopening it", () => {
    render(() => (
      <ProcessFold parts={[reasoningPart("done")]} startedAt={1000} completedAt={61000} />
    ));
    expect(screen.getByTestId("process-fold-status")).toHaveTextContent("Took 1m 0s");
    expect(screen.getByTestId("process-fold-toggle")).toHaveAttribute("aria-expanded", "false");
  });
});
