// Shared chrome and helpers for the tool card family (TASK-M3-01): the
// output copy button, the collapsible raw input disclosure, duration
// formatting and small input/output extractors used by the tool-specific
// cards in tools/. Tool icons live in ../icons.tsx (PROCESS-REF-05).

import { createSignal } from "solid-js";
import type { Component } from "solid-js";
import type { ToolPartData } from "../ToolPart.js";
import { useT } from "../../../../i18n/index.js";

export interface ToolCardProps {
  part: ToolPartData;
}

export type ToolCard = Component<ToolCardProps>;

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
