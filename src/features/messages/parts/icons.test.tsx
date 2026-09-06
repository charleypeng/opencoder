import { describe, expect, it } from "vitest";
import { For } from "solid-js";
import { render } from "@solidjs/testing-library";
import { attachmentIconKind, ContentIcon, ICON_BODY, toolIconKind, type IconKind } from "./icons";

describe("toolIconKind", () => {
  // Table-driven over the verified alias table: every entry has repository
  // evidence (mock fixtures or an existing classification regex).
  it.each([
    ["bash", "terminal"],
    ["Bash", "terminal"],
    ["shell", "terminal"],
    ["exec", "terminal"],
    ["terminal", "terminal"],
    ["command", "terminal"],
    ["run", "terminal"],
    ["read", "read"],
    ["edit", "edit"],
    ["multiedit", "edit"],
    ["apply_patch", "edit"],
    ["patch", "edit"],
    ["delete", "edit"],
    ["move", "edit"],
    ["rename", "edit"],
    ["write", "write"],
    ["create", "write"],
    ["glob", "glob"],
    ["grep", "grep"],
    ["question", "question"],
    ["todowrite", "todo"],
    ["task", "todo"],
  ])("maps %s to %s", (tool, expected) => {
    expect(toolIconKind(tool)).toBe(expected as IconKind);
  });

  it("maps unknown and unproven tools to the generic glyph", () => {
    // No repository evidence backs webfetch/skill/MCP aliases, so they must
    // not be guessed into a specific class.
    expect(toolIconKind("webfetch")).toBe("tool");
    expect(toolIconKind("skill")).toBe("tool");
    expect(toolIconKind("mcp__server__read_file")).toBe("tool");
    expect(toolIconKind("")).toBe("tool");
  });

  it("does not classify by loose substrings", () => {
    // A made-up MCP tool containing a known name must stay generic.
    expect(toolIconKind("acme_reader")).toBe("tool");
    expect(toolIconKind("runnable_report")).toBe("tool");
  });
});

describe("attachmentIconKind", () => {
  it.each([
    ["image/png", "photo.png", "image"],
    ["video/mp4", "clip.mp4", "video"],
    ["audio/wav", "note.wav", "audio"],
    ["application/pdf", "doc.pdf", "pdf"],
    ["application/zip", "bundle.zip", "archive"],
    ["application/gzip", "pkg.tar.gz", "archive"],
    ["application/json", "data.json", "code"],
    ["application/javascript", "app.js", "code"],
    ["text/plain", "notes.txt", "text-doc"],
    ["text/markdown", "README.md", "text-doc"],
    ["application/octet-stream", "unknown.bin", "file"],
    [undefined, undefined, "file"],
    ["   ", "   ", "file"],
  ])("maps mime %s + %s to %s", (mime, filename, expected) => {
    expect(attachmentIconKind(mime, filename)).toBe(expected as IconKind);
  });

  it("falls back to the extension when the mime is absent or generic", () => {
    expect(attachmentIconKind(undefined, "archive.tar.gz")).toBe("archive");
    expect(attachmentIconKind("application/octet-stream", "report.pdf")).toBe("pdf");
    expect(attachmentIconKind("", "script.ts")).toBe("code");
    // Query/hash never participate in extension matching.
    expect(attachmentIconKind(undefined, "movie.mp4?token=1#frag")).toBe("video");
  });

  it("lets a concrete mime win over a conflicting extension", () => {
    expect(attachmentIconKind("image/png", "archive.zip")).toBe("image");
    expect(attachmentIconKind("text/plain", "movie.mp4")).toBe("text-doc");
  });
});

describe("ContentIcon", () => {
  it("draws at least one shape for every kind", () => {
    const kinds = Object.keys(ICON_BODY) as IconKind[];
    expect(kinds.length).toBeGreaterThan(20);
    const { container } = render(() => (
      <For each={kinds}>{(kind) => <ContentIcon kind={kind} />}</For>
    ));
    const slots = container.querySelectorAll<HTMLElement>("[data-icon-kind]");
    kinds.forEach((kind, index) => {
      const svg = slots[index]?.querySelector("svg");
      expect(svg?.children.length, `kind ${kind}`).toBeGreaterThan(0);
    });
  });

  it("renders decorative svg inside a fixed slot", () => {
    const { container } = render(() => <ContentIcon kind="terminal" />);
    const slot = container.querySelector<HTMLElement>("[data-icon-kind]");
    expect(slot).not.toBeNull();
    expect(slot).toHaveAttribute("aria-hidden", "true");
    expect(slot).toHaveClass("shrink-0");
    const svg = slot?.querySelector("svg");
    expect(svg?.getAttribute("focusable")).toBe("false");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg?.getAttribute("stroke-width")).toBe("1.5");
  });

  it("keeps the category icon stable across tool statuses", () => {
    // The kind derives from the tool name only — the four-state machine never
    // swaps the glyph (status is expressed by copy and duration instead).
    for (const tool of ["bash", "read", "edit", "write", "glob", "grep", "question"]) {
      expect(toolIconKind(tool.toUpperCase())).toBe(toolIconKind(tool));
    }
  });
});
