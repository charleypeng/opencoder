// L2 tests for the text part (TASK-M2-07): the part text renders through
// the markdown pipeline (plain pre-wrap was replaced by markdown rendering
// in this task).

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

  it("renders markdown structure", () => {
    render(() => <TextPart part={textPart("## Heading\n\nSome **bold** text")} />);
    const el = screen.getByTestId("text-part");
    expect(el.querySelector("h2")?.textContent).toBe("Heading");
    expect(el.querySelector("strong")?.textContent).toBe("bold");
  });

  it("escapes raw HTML in the source", () => {
    render(() => <TextPart part={textPart("<script>alert(1)</script>")} />);
    const el = screen.getByTestId("text-part");
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toContain("<script>alert(1)</script>");
  });
});
