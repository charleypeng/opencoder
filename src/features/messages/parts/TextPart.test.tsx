// L2 tests for the text part (TASK-M2-06): plain text rendering with
// preserved whitespace (markdown rendering lands in TASK-M2-07).

import { describe, expect, it } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import TextPart, { type TextPartData } from "./TextPart";

function textPart(text: string): TextPartData {
  return { id: "prt_t", sessionID: "sess_1", messageID: "msg_1", type: "text", text };
}

describe("TextPart", () => {
  it("renders the part text", () => {
    render(() => <TextPart part={textPart("Hello world")} />);
    expect(screen.getByTestId("text-part")).toHaveTextContent("Hello world");
  });

  it("preserves whitespace and line breaks", () => {
    render(() => <TextPart part={textPart("line one\n\nline two   spaced")} />);
    const el = screen.getByTestId("text-part");
    expect(el).toHaveTextContent("line one");
    // jest-dom normalizes whitespace, so the multi-space run collapses.
    expect(el).toHaveTextContent("line two spaced");
    expect(el.className).toContain("whitespace-pre-wrap");
  });
});
