// L2 tests for the process fold (chat refactor): reasoning + tool calls of
// one message are grouped into a single fold below the answer. The fold is
// collapsed by default with a status summary (call count, succeeded/failed/
// running, reasoning volume); clicking expands it with a grid-row animation.
// Streaming marks the trace as active but does not force it open.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import ProcessFold from "./ProcessFold";
import type { Part } from "../../../stores/messages";
import { clearActivityViewState } from "../activity/activityViewState";

function reasoningPart(text: string, id = "prt_r", end: number | null = 2): Part {
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
  id: string,
): Part {
  const base = {
    id,
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "tool" as const,
    callID: `call_${id}`,
    tool,
  };
  switch (status) {
    case "completed":
      return {
        ...base,
        state: {
          status,
          input: {},
          output: "ok",
          title: tool,
          metadata: {},
          time: { start: 1, end: 2 },
        },
      };
    case "error":
      return { ...base, state: { status, input: {}, error: "boom", time: { start: 1, end: 2 } } };
    case "running":
      return { ...base, state: { status, input: {}, time: { start: 1 } } };
    case "pending":
      return { ...base, state: { status, input: {}, raw: "{}" } };
  }
}

function progressText(): Part {
  return {
    id: "prt_progress",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "text",
    text: "I found the message renderer and am checking its event flow.",
    time: { start: 3, end: 4 },
  };
}

describe("ProcessFold", () => {
  beforeEach(() => clearActivityViewState());
  afterEach(() => vi.useRealTimers());

  it("renders collapsed by default with a tool-call summary", () => {
    render(() => (
      <ProcessFold
        parts={[toolPart("bash", "completed", "p1"), toolPart("grep", "completed", "p2")]}
      />
    ));
    const toggle = screen.getByTestId("process-fold-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("process-fold-body")).toHaveAttribute("data-expanded", "false");
    // The body is hidden from screen readers and interaction while collapsed.
    expect(screen.getByTestId("process-fold-body")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("process-fold-summary")).toHaveTextContent(
      "2 tool calls · 2 succeeded",
    );
  });

  it("expands on click to show reasoning and tool parts, collapses again", () => {
    render(() => (
      <ProcessFold
        parts={[reasoningPart("planning the change"), toolPart("bash", "completed", "p1")]}
      />
    ));
    const toggle = screen.getByTestId("process-fold-toggle");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const body = screen.getByTestId("process-fold-body");
    expect(body).toHaveAttribute("data-expanded", "true");
    expect(body).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByTestId("reasoning-body")).toHaveTextContent("planning the change");
    expect(screen.getByTestId("tool-part")).toHaveAttribute("data-status", "completed");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("process-fold-body")).toHaveAttribute("aria-hidden", "true");
  });

  it("summarizes failed and in-progress calls", () => {
    render(() => (
      <ProcessFold
        parts={[
          toolPart("bash", "completed", "p1"),
          toolPart("read", "error", "p2"),
          toolPart("grep", "running", "p3"),
        ]}
      />
    ));
    expect(screen.getByTestId("process-fold-summary")).toHaveTextContent(
      "3 tool calls · 1 succeeded · 1 failed · 1 running",
    );
  });

  it("shows reasoning volume when there are no tool calls", () => {
    render(() => <ProcessFold parts={[reasoningPart("a".repeat(1500))]} />);
    expect(screen.getByTestId("process-fold-summary")).toHaveTextContent("1.5k chars of reasoning");
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("renders nothing for absent parts", () => {
    render(() => <ProcessFold parts={[undefined, undefined]} />);
    expect(screen.queryByTestId("reasoning-part")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tool-part")).not.toBeInTheDocument();
    expect(screen.getByTestId("process-fold-summary")).toHaveTextContent("");
  });

  it("stays collapsed while streaming until the user opens it", async () => {
    const [streaming, setStreaming] = createSignal(true);
    render(() => (
      <ProcessFold
        parts={[reasoningPart("thinking live", "prt_r", null)]}
        streaming={streaming()}
      />
    ));
    const toggle = screen.getByTestId("process-fold-toggle");
    await Promise.resolve();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("process-fold")).toHaveAttribute("data-active", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("reasoning-body")).toHaveTextContent("thinking live");
    setStreaming(false);
    await Promise.resolve();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("process-fold")).toHaveAttribute("data-active", "true");
  });

  it("keeps a manual toggle effective across streaming flips", async () => {
    const [streaming, setStreaming] = createSignal(true);
    render(() => <ProcessFold parts={[reasoningPart("thinking")]} streaming={streaming()} />);
    const toggle = screen.getByTestId("process-fold-toggle");
    await Promise.resolve();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Manual disclosure is the only ordinary expansion path.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Stream flips do not steal the user's disclosure choice.
    setStreaming(false);
    await Promise.resolve();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // The toggle still works afterwards.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows an immediate, ticking wait state before the first event arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(3000);
    render(() => <ProcessFold parts={[]} active startedAt={1000} runKey="waiting-run" />);

    const fold = screen.getByTestId("process-fold");
    expect(fold).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("process-fold-toggle")).toBeDisabled();
    expect(screen.getByTestId("process-fold-status")).toHaveTextContent("Working for 2s");
    expect(screen.getByTestId("process-fold-current")).toHaveTextContent(
      "Waiting for model response",
    );

    vi.advanceTimersByTime(2000);
    expect(screen.getByTestId("process-fold-status")).toHaveTextContent("Working for 4s");
  });

  it("renders progress updates inside the disclosure", () => {
    render(() => <ProcessFold parts={[progressText()]} />);
    fireEvent.click(screen.getByTestId("process-fold-toggle"));

    expect(screen.getByTestId("activity-entry")).toHaveAttribute("data-kind", "note");
    expect(screen.getByText("Update")).toBeInTheDocument();
    expect(screen.getByTestId("text-part")).toHaveTextContent(
      "I found the message renderer and am checking its event flow.",
    );
  });

  it("reports the total completed run duration", () => {
    render(() => (
      <ProcessFold parts={[reasoningPart("done")]} startedAt={1000} completedAt={61000} />
    ));
    expect(screen.getByTestId("process-fold-status")).toHaveTextContent("Worked for 1m 0s");
  });

  it("counts one tool call across running and completed lifecycle updates", () => {
    const running = toolPart("bash", "running", "running") as Extract<Part, { type: "tool" }>;
    const completed = toolPart("bash", "completed", "completed") as Extract<Part, { type: "tool" }>;
    completed.callID = running.callID;
    render(() => <ProcessFold parts={[running, completed]} />);

    expect(screen.getByTestId("process-fold-summary")).toHaveTextContent(
      "1 tool call · 1 succeeded",
    );
  });
});
