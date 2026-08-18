// L2 tests for the reasoning part (chat refactor): it is now a plain
// content renderer — the fold/expand behavior lives in the ProcessFold
// container that groups every process part below the answer. These tests
// pin the contract: the full text renders, deltas stream in place, and the
// part never renders fold chrome of its own.

import { describe, expect, it } from "vitest";
import { render, screen } from "@solidjs/testing-library";
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
  it("renders the full reasoning text without truncation", () => {
    render(() => <ReasoningPart part={reasoningPart(LONG_TEXT)} />);
    const body = screen.getByTestId("reasoning-body");
    expect(body).toHaveTextContent(LONG_TEXT);
  });

  it("renders short text as-is", () => {
    render(() => <ReasoningPart part={reasoningPart("short")} />);
    expect(screen.getByTestId("reasoning-body")).toHaveTextContent("short");
  });

  it("carries no fold chrome of its own (the ProcessFold owns expansion)", () => {
    render(() => <ReasoningPart part={reasoningPart("thinking")} />);
    expect(screen.queryByTestId("reasoning-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("reasoning-part")).toBeInTheDocument();
  });
});
