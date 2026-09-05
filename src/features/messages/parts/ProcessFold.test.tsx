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

    fireEvent.click(screen.getByTestId("activity-entry-toggle"));
    expect(screen.getByTestId("reasoning-body")).toHaveTextContent("planning the change");

    fireEvent.click(screen.getByTestId("tool-toggle"));
    expect(screen.getByTestId("tool-summary")).toHaveTextContent("Ran command");
    expect(screen.getByTestId("tool-terminal")).toHaveTextContent("$ git status --short");
  });

  it("renders progress, thought, and tool rows in their source order", () => {
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
    const thought = screen.getByTestId("activity-entry-toggle");
    const tool = screen.getByTestId("tool-part");
    expect(
      progress.compareDocumentPosition(thought) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(thought.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("restores thought and tool disclosures after an unmount", () => {
    const props = {
      active: true,
      runKey: "server:session:live",
      parts: [reasoningPart("thinking"), toolPart("bash", "completed")],
    };
    const first = render(() => <ProcessFold {...props} />);
    fireEvent.click(screen.getByTestId("activity-entry-toggle"));
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
