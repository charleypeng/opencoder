// L1 renderer tests (TASK-M2-07): GFM constructs (headings, tables,
// strikethrough, task lists), raw-HTML escaping, XSS sanitization of
// script-ish payloads, external link rewriting with safe rel/target, code
// fence placeholders, and a complex-fixture render check.

import { describe, expect, it } from "vitest";
import fixtureSource from "../../../../tests/fixtures/markdown.complex.md?raw";
import { decodeFenceCode, escapeHtml, renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders headings and emphasis", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** and `inline` text.");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>inline</code>");
  });

  it("renders GFM tables and strikethrough", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("<s>gone</s>");
  });

  it("renders task lists as disabled checkboxes", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('class="contains-task-list"');
    expect(html).toContain('class="task-list-item"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain("disabled");
  });

  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("strips script injection from the rendered output", () => {
    const payloads = [
      "<script>alert(1)</script>",
      '<img src="x" onerror="alert(1)">',
      '<svg onload="alert(1)"></svg>',
      "[click](javascript:alert(1))",
      "[click](data:text/html;base64,PHNjcmlwdD4=)",
      "````\n<script>alert(1)</script>\n````",
    ];
    for (const payload of payloads) {
      const html = renderMarkdown(payload);
      // Raw tags never survive: html:false escapes them into text (layer 1)
      // and DOMPurify strips anything the parser still emitted (layer 2).
      expect(html, payload).not.toMatch(/<(?:script|img|svg)[\s>/]/i);
      // Dangerous URL schemes never become href attributes (markdown-it
      // validateLink + DOMPurify URI checking).
      expect(html, payload).not.toMatch(/href="(?:javascript|data):/i);
    }
  });

  it("opens external links in a new tab with a safe rel", () => {
    const html = renderMarkdown("[docs](https://example.com/docs)");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("emits code fences as inert placeholders", () => {
    const html = renderMarkdown("```ts\nconst x = 1 < 2;\n```");
    expect(html).toContain('class="code-fence"');
    expect(html).toContain('data-fence-lang="ts"');
    expect(html).toContain(`data-fence-code="${encodeURIComponent("const x = 1 < 2;\n")}"`);
    expect(html).not.toContain("<pre");
  });

  it("renders the complex fixture", () => {
    const html = renderMarkdown(fixtureSource);
    expect(html).toContain("<h1>Complex Markdown Fixture (TASK-M2-07)</h1>");
    expect(html).toContain("<h2>Features</h2>");
    expect(html).toContain("<table>");
    expect(html).toContain('class="contains-task-list"');
    expect(html).toContain("<blockquote>");
    expect(html).toContain('class="code-fence"');
    expect(html).toContain('data-fence-lang="ts"');
    expect(html).toContain('data-fence-lang="bash"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toMatch(/<script/i);
  });
});

describe("escapeHtml", () => {
  it("escapes attribute-breaking characters", () => {
    expect(escapeHtml(`a&b"c'<d>`)).toBe("a&amp;b&quot;c&#39;&lt;d&gt;");
  });
});

describe("decodeFenceCode", () => {
  it("round-trips URI-encoded payloads", () => {
    const payload = encodeURIComponent("const x = '<y>';\n");
    expect(decodeFenceCode(payload)).toBe("const x = '<y>';\n");
  });

  it("falls back to the raw value on malformed input", () => {
    expect(decodeFenceCode("%E0%A4%A")).toBe("%E0%A4%A");
  });
});
