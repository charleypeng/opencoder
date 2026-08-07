// Markdown message text renderer (TASK-M2-07): renders sanitized markdown
// through innerHTML (the only innerHTML in the codebase — the markup comes
// from markdown.ts, i.e. markdown-it with html:false followed by DOMPurify,
// never raw user input). Code-fence placeholders are then hydrated with
// Shiki output and copy buttons are wired via event delegation on the
// container (buttons are injected as HTML, so delegated clicks avoid
// re-scanning on every render).

import { createEffect, createMemo, onCleanup } from "solid-js";
import type { Component } from "solid-js";
import { highlightCode } from "./highlighter.js";
import { CODE_FENCE_SELECTOR, decodeFenceCode, escapeHtml, renderMarkdown } from "./markdown.js";
import { useT } from "../../../i18n/index.js";
import "./markdown.css";

/**
 * IA-09 highlight debounce: during streaming, syntax highlighting re-runs on
 * every delta. Debouncing at 250ms prevents expensive Shiki re-runs on every
 * token while keeping the visual latency under 300ms. Static (non-streaming)
 * renders hydrate immediately.
 */
const HIGHLIGHT_DEBOUNCE_MS = 250;

/** Code payload per copy button; a WeakMap keeps large snippets out of the
 *  DOM attributes. */
const copyCodeByButton = new WeakMap<HTMLElement, string>();

const COPY_FEEDBACK_MS = 1500;

function fenceHtml(lang: string, body: string, copyLabel: string, copyCodeLabel: string): string {
  const label = lang === "" ? "" : `<span class="code-fence-lang">${escapeHtml(lang)}</span>`;
  const copy = `<button type="button" class="code-fence-copy" data-copy-code aria-label="${copyCodeLabel}">${copyLabel}</button>`;
  return `<div class="code-fence-header">${label}${copy}</div>${body}`;
}

/** Copies text via the async Clipboard API with a legacy execCommand
 *  fallback (e.g. non-secure contexts, older WebViews). */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

async function hydrateFence(el: HTMLElement, t: (key: string) => string): Promise<void> {
  const lang = el.dataset.fenceLang ?? "";
  const code = decodeFenceCode(el.dataset.fenceCode ?? "");
  let body: string;
  try {
    body = await highlightCode(code, lang);
  } catch {
    // Highlighting unavailable (e.g. language pack failure): render the
    // code as plain, escaped <pre><code>.
    body = `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
  // The placeholder may have been replaced by a streamed update while the
  // language was loading; only hydrate nodes still attached to this render.
  if (!el.isConnected || el.dataset.fenceState === "hydrated") return;
  el.innerHTML = fenceHtml(lang, body, t("common:copy"), t("messages:copyCode"));
  const button = el.querySelector<HTMLElement>("[data-copy-code]");
  if (button !== null) copyCodeByButton.set(button, code);
  el.dataset.fenceState = "hydrated";
}

function hydrateFences(container: HTMLElement | undefined, t: (key: string) => string): void {
  if (container === undefined) return;
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(CODE_FENCE_SELECTOR))) {
    if (el.dataset.fenceState === "hydrated") continue;
    el.dataset.fenceState = "hydrating";
    void hydrateFence(el, t);
  }
}

export interface MarkdownTextProps {
  /** Markdown source to render. */
  text: string;
}

const MarkdownText: Component<MarkdownTextProps> = (props) => {
  const t = useT();
  let containerRef: HTMLDivElement | undefined;
  const html = createMemo(() => renderMarkdown(props.text));

  // IA-09: Re-hydrates fences after every render pass; placeholders from a
  // newer pass replace the old nodes, so hydration is always idempotent.
  // During streaming, hydration is debounced to avoid expensive Shiki
  // re-runs on every delta token. Static renders hydrate immediately.
  let hydrateTimer: ReturnType<typeof setTimeout> | undefined;
  let firstRender = true;
  onCleanup(() => clearTimeout(hydrateTimer));
  createEffect(() => {
    void html();
    if (firstRender) {
      // First render: hydrate immediately for snappy static display.
      firstRender = false;
      hydrateFences(containerRef, t);
    } else {
      // Streaming / subsequent renders: debounce to ~250ms.
      clearTimeout(hydrateTimer);
      hydrateTimer = setTimeout(() => {
        hydrateFences(containerRef, t);
      }, HIGHLIGHT_DEBOUNCE_MS);
    }
  });

  function handleClick(event: MouseEvent) {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLElement>("[data-copy-code]") ?? null;
    if (button === null) return;
    const code = copyCodeByButton.get(button);
    if (code === undefined) return;
    void copyToClipboard(code).then((ok) => {
      if (!ok) return;
      button.textContent = t("common:copied");
      setTimeout(() => {
        button.textContent = t("common:copy");
      }, COPY_FEEDBACK_MS);
    });
  }

  return (
    <div
      ref={containerRef}
      data-testid="markdown-text"
      class="markdown-body text-sm leading-relaxed"
      // eslint-disable-next-line solid/no-innerhtml -- sanitized in markdown.ts (markdown-it html:false + DOMPurify); fences hydrate as inert placeholders
      innerHTML={html()}
      onClick={handleClick}
    />
  );
};

export default MarkdownText;
