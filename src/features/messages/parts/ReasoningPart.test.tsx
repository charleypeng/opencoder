// L2 tests for the reasoning part (TASK-M2-06): collapsed by default with a
// truncated preview, expanding on click reveals the full text, collapsing
// again hides it.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import ReasoningPart, { type ReasoningPartData } from "./ReasoningPart";

function reasoningPart(text: string): ReasoningPartData {
  return {
    id: "prt_r",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "reasoning",
    text,
    time: { start: 1, end: 2 },
  };
}

const LONG_TEXT = "a".repeat(120);

describe("ReasoningPart", () => {
  it("renders collapsed by default with the Reasoning label and a preview", () => {
    render(() => <ReasoningPart part={reasoningPart(LONG_TEXT)} />);
    const toggle = screen.getByTestId("reasoning-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    // Preview truncates long reasoning text.
    expect(screen.getByText(`${"a".repeat(60)}…`)).toBeInTheDocument();
    expect(screen.queryByTestId("reasoning-body")).not.toBeInTheDocument();
  });

  it("expands to show the full text and collapses again", () => {
    render(() => <ReasoningPart part={reasoningPart(LONG_TEXT)} />);
    const toggle = screen.getByTestId("reasoning-toggle");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const body = screen.getByTestId("reasoning-body");
    expect(body).toHaveTextContent(LONG_TEXT);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("reasoning-body")).not.toBeInTheDocument();
  });

  it("keeps short text un-truncated in the preview", () => {
    render(() => <ReasoningPart part={reasoningPart("short")} />);
    expect(screen.getByText("short")).toBeInTheDocument();
  });
});
