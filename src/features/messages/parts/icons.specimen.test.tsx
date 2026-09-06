// Test-only icon specimen (PROCESS-REF-05 visual verification): renders
// every ContentIcon glyph through the real component and, when
// ICON_SPECIMEN_DIR is set, writes a light and a dark HTML page next to that
// directory for screenshot review. The page never ships in the product
// navigation; the test is a no-op without the env var.
//
//   ICON_SPECIMEN_DIR=/tmp pnpm vitest run src/features/messages/parts/icons.specimen.test.tsx

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { For } from "solid-js";
import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { ContentIcon, ICON_BODY, type IconKind } from "./icons";

const KINDS = Object.keys(ICON_BODY) as IconKind[];

function specimenHtml(theme: "light" | "dark"): string {
  const tokens =
    theme === "light"
      ? { bg: "#ffffff", fg: "#586071", label: "#191e29" }
      : { bg: "#0f1115", fg: "#9aa3b2", label: "#e8eaf0" };
  const { container } = render(() => (
    <div class="grid">
      <For each={KINDS}>
        {(kind) => (
          <div class="cell">
            <ContentIcon kind={kind} />
            <span class="label">{kind}</span>
          </div>
        )}
      </For>
    </div>
  ));
  return `<!doctype html>
<html data-theme="${theme}">
<head><meta charset="utf-8"><style>
  body { margin: 0; background: ${tokens.bg}; color: ${tokens.fg};
         font: 12px system-ui, sans-serif; }
  .grid { display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr));
          gap: 16px; padding: 24px; }
  .cell { display: flex; align-items: center; gap: 8px; color: ${tokens.fg}; }
  .cell svg { width: 14px; height: 14px; }
  .label { color: ${tokens.label}; }
</style></head>
<body>${container.innerHTML}</body></html>`;
}

describe("icon specimen", () => {
  it("renders every glyph for the light/dark specimen pages", () => {
    expect(KINDS.length).toBeGreaterThan(20);
    const dir = process.env.ICON_SPECIMEN_DIR;
    if (dir === undefined || dir === "") return;
    for (const theme of ["light", "dark"] as const) {
      const html = specimenHtml(theme);
      expect(html).toContain("data-icon-kind");
      writeFileSync(join(dir, `icon-specimen-${theme}.html`), html);
    }
  });
});
