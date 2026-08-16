// Shared chrome and helpers for the tool card family (TASK-M3-01): the
// state icon (pending clock / running spinner / completed check / error
// cross), the per-tool icon, the output copy button, the collapsible raw
// input disclosure, duration formatting and small input/output extractors
// used by the tool-specific cards in tools/.

import { createMemo, createSignal } from "solid-js";
import type { Component, JSX } from "solid-js";
import type { ToolPartData, ToolStatus } from "../ToolPart.js";
import { useT } from "../../../../i18n/index.js";

export interface ToolCardProps {
  part: ToolPartData;
}

export type ToolCard = Component<ToolCardProps>;

export function StatusIcon(props: { status: ToolStatus }) {
  // Memoized so the switch stays inside a tracked scope (the status of a
  // part identity never changes while rendering).
  const icon = createMemo(() => {
    switch (props.status) {
      case "running":
        return (
          <span
            aria-hidden
            class="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
          />
        );
      case "completed":
        return (
          <svg
            aria-hidden
            class="h-3.5 w-3.5 shrink-0 text-success"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        );
      case "error":
        return (
          <svg
            aria-hidden
            class="h-3.5 w-3.5 shrink-0 text-danger"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        );
      default:
        // Pending: a clock that breathes until the call starts.
        return (
          <svg
            aria-hidden
            class="h-3.5 w-3.5 shrink-0 animate-pulse text-fg-faint"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          >
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 5v3l2 1.5" />
          </svg>
        );
    }
  });
  return <>{icon()}</>;
}

const TOOL_ICON_BODY: Record<string, JSX.Element> = {
  bash: (
    <>
      <path d="M2.5 3.5 6.5 8l-4 4.5" />
      <path d="M8 12.5h5.5" />
    </>
  ),
  edit: <path d="m11.3 2.8 1.9 1.9-6.9 6.9H4.4v-1.9Z" />,
  read: (
    <>
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
      <path d="M6 5.5h4M6 8h4M6 10.5h2.5" />
    </>
  ),
  write: (
    <>
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
      <path d="M6 5.5h4M6 8h4M6 10.5h2.5" />
      <path d="M11.5 10.5v3M10 12h3" />
    </>
  ),
  glob: <path d="M2 3.5h3.5l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />,
  grep: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="m10.2 10.2 3.3 3.3" />
    </>
  ),
  default: (
    <>
      <path d="M3 5.5 8 2.8l5 2.7v5l-5 2.7-5-2.7Z" />
      <path d="M3 5.5l5 2.7 5-2.7M8 8.2v5" />
    </>
  ),
};

export function ToolIcon(props: { tool: string }) {
  const body = createMemo(() => TOOL_ICON_BODY[props.tool] ?? TOOL_ICON_BODY.default);
  return (
    <svg
      aria-hidden
      class="h-3.5 w-3.5 shrink-0 text-fg-faint"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {body()}
    </svg>
  );
}

const COPY_FEEDBACK_MS = 1500;

/** Copies text via the async Clipboard API with a legacy execCommand
 *  fallback (mirrors the markdown code fence copy in MarkdownText). */
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

export function CopyButton(props: { text: string }) {
  const t = useT();
  const [copied, setCopied] = createSignal(false);
  async function handleCopy() {
    const ok = await copyToClipboard(props.text);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }
  return (
    <button
      type="button"
      data-testid="tool-copy"
      class="shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] text-fg-faint outline-none hover:bg-accent-soft hover:text-fg-primary focus:bg-accent-soft"
      onClick={() => void handleCopy()}
    >
      {copied() ? t("common:copied") : t("common:copy")}
    </button>
  );
}

/** Human-readable duration from a millisecond span ("45ms", "1.2s", "2m 3s"). */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${Math.round((ms / 1000) * 10) / 10}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Header duration label: metadata.duration wins, otherwise measured from
 *  the call's time span (or the live elapsed time while running). */
export function durationLabel(state: ToolPartData["state"], nowMs: number): string | undefined {
  if (state.status === "pending") return undefined;
  const metadata = (state.metadata ?? {}) as Record<string, unknown>;
  const fromMetadata = metadata.duration;
  if (typeof fromMetadata === "string") return fromMetadata;
  if (typeof fromMetadata === "number") return formatDuration(fromMetadata);
  if (state.status === "running") return formatDuration(nowMs - state.time.start);
  return formatDuration(state.time.end - state.time.start);
}

/** First string field found under any of the given input keys. */
export function inputString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/** Completed-state output text, narrowed for the card sections. */
export function outputText(part: ToolPartData): string {
  return part.state.status === "completed" ? part.state.output : "";
}

/** Non-empty output lines (used for count badges and result lists). */
export function outputLines(part: ToolPartData): string[] {
  return outputText(part)
    .split("\n")
    .filter((line) => line.length > 0);
}
