// L2 tests for MarkdownText (TASK-M2-07): sanitized markdown rendering,
// code-fence hydration through a mocked Shiki (language selection, plain
// "text" fallback for unknown languages), the plain-pre fallback when
// highlighting fails, copy-button behavior with a mocked clipboard, and a
// security check that fence content stays inert.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";

const { codeToHtmlMock, getSingletonHighlighterMock } = vi.hoisted(() => ({
  codeToHtmlMock: vi.fn(),
  getSingletonHighlighterMock: vi.fn(),
}));

vi.mock("shiki", () => ({ getSingletonHighlighter: getSingletonHighlighterMock }));

/** Escapes like Shiki does: code becomes inert text inside the token spans. */
function mockCodeToHtml(code: string): string {
  return `<pre class="shiki"><code>${code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</code></pre>`;
}

const highlighter = {
  getLoadedLanguages: vi.fn(),
  loadLanguage: vi.fn(async () => undefined),
  codeToHtml: codeToHtmlMock,
};

let writeTextMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Fresh module registry per test: the highlighter singleton caches its
  // instance at module scope, so rejecting/loading paths need a clean state.
  vi.resetModules();
  getSingletonHighlighterMock.mockReset().mockResolvedValue(highlighter);
  highlighter.getLoadedLanguages.mockReset().mockReturnValue(["text", "ts", "js"]);
  highlighter.loadLanguage.mockReset().mockResolvedValue(undefined);
  codeToHtmlMock.mockReset().mockImplementation(mockCodeToHtml);
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: writeTextMock },
  });
});

afterEach(() => {
  // The clipboard is a test-only stub on top of jsdom's navigator.
  delete (navigator as { clipboard?: unknown }).clipboard;
});

/** Mounts MarkdownText with a fresh import (see beforeEach resetModules). */
async function mount(text: string) {
  const { default: MarkdownText } = await import("./MarkdownText");
  return render(() => <MarkdownText text={text} />);
}

function rendered() {
  return screen.getByTestId("markdown-text");
}

/** Waits until a fence placeholder has been hydrated. */
async function hydratedFence() {
  const el = rendered();
  await waitFor(() => expect(el.querySelector(".code-fence-header")).not.toBeNull());
  return el;
}

describe("MarkdownText", () => {
  it("renders markdown structure", async () => {
    await mount("# Hi\n\nSome **bold** text");
    const el = rendered();
    expect(el.querySelector("h1")?.textContent).toBe("Hi");
    expect(el.querySelector("strong")?.textContent).toBe("bold");
  });

  it("escapes raw HTML in the source", async () => {
    await mount("<script>alert(1)</script>");
    expect(rendered().querySelector("script")).toBeNull();
    expect(rendered().textContent).toContain("<script>alert(1)</script>");
  });

  it("hydrates code fences through the highlighter with the fence language", async () => {
    await mount("```ts\nconst x = 1;\n```");
    const el = await hydratedFence();
    expect(el.querySelector(".shiki")).not.toBeNull();
    expect(codeToHtmlMock).toHaveBeenCalledWith(
      "const x = 1;\n",
      expect.objectContaining({ lang: "ts" }),
    );
    expect(el.querySelector(".code-fence-lang")?.textContent).toBe("ts");
  });

  it("renders unlabeled fences without a language label", async () => {
    await mount("```\nplain\n```");
    const el = await hydratedFence();
    expect(el.querySelector(".code-fence-lang")).toBeNull();
    expect(codeToHtmlMock).toHaveBeenCalledWith(
      "plain\n",
      expect.objectContaining({ lang: "text" }),
    );
  });

  it("falls back to plain text highlighting for unknown languages", async () => {
    highlighter.loadLanguage.mockRejectedValue(new Error("unknown language: graphql"));
    await mount("```graphql\nquery { me }\n```");
    const el = await hydratedFence();
    expect(highlighter.loadLanguage).toHaveBeenCalledWith("graphql");
    expect(codeToHtmlMock).toHaveBeenCalledWith(
      "query { me }\n",
      expect.objectContaining({ lang: "text" }),
    );
    expect(el.querySelector(".code-fence-lang")?.textContent).toBe("graphql");
  });

  it("renders a plain, escaped pre when highlighting fails", async () => {
    getSingletonHighlighterMock.mockRejectedValue(new Error("wasm unavailable"));
    await mount("```ts\nconst x = '<y>';\n```");
    const el = await hydratedFence();
    expect(el.querySelector(".shiki")).toBeNull();
    const code = el.querySelector("pre code");
    expect(code?.textContent).toBe("const x = '<y>';\n");
  });

  it("copies fence code from the copy button", async () => {
    await mount("```ts\nconst x = 1;\n```");
    const el = await hydratedFence();
    const button = el.querySelector<HTMLButtonElement>("[data-copy-code]");
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith("const x = 1;\n"));
    await waitFor(() => expect(button?.textContent).toBe("Copied!"));
  });

  it("keeps script payloads inside fences inert", async () => {
    await mount("```html\n<script>alert(1)</script>\n```");
    const el = await hydratedFence();
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toContain("<script>alert(1)</script>");
  });
});
