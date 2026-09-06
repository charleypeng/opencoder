// File attachment card (TASK-M3-02): renders a FilePart as an attachment
// chip — mime-derived icon (image/video/text/generic file), file name
// (falling back to the URL or source path basename) and, when the part
// carries inline content, a click-to-expand preview. Media is only rendered
// from data URLs supplied by the API; remote URLs are NEVER loaded.
//
// IA-24: FilePart renders as a context entry — a visual cue that this
// file is part of the AI's current context. The file path is shown in
// monospace, the mime type is displayed as a small badge, and the card
// carries a subtle "context" indicator so users can see what the AI
// knows about.

import { createMemo, createSignal, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import type { Part } from "../../../stores/messages.js";
import { useT } from "../../../i18n/index.js";

export type FilePartData = Extract<Part, { type: "file" }>;

export interface FilePartProps {
  part: FilePartData;
}

type MimeKind = "image" | "video" | "text" | "other";

function mimeKind(mime: string): MimeKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/")) return "text";
  return "other";
}

const MIME_ICON: Record<MimeKind, JSX.Element> = {
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1" />
      <path d="m3.5 11.5 3-2.5 2.5 2 2.5-2.5 1 1.5" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="4" width="9" height="8" rx="1.5" />
      <path d="m11.5 6.5 3-1.5v7l-3-1.5" />
      <path d="M6 7.5v1M5.5 13.5h5" />
    </>
  ),
  text: (
    <>
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
      <path d="M6 5.5h4M6 8h4M6 10.5h2.5" />
    </>
  ),
  other: (
    <>
      <path d="M3 5.5 8 2.8l5 2.7v5l-5 2.7-5-2.7Z" />
      <path d="M3 5.5l5 2.7 5-2.7M8 8.2v5" />
    </>
  ),
};

function basename(url: string): string {
  const base = url.slice(url.lastIndexOf("/") + 1);
  return base.length > 0 ? base : "";
}

/** File/symbol sources carry a path; resource sources only a URI. */
function sourcePath(source: FilePartData["source"]): string | undefined {
  if (source !== undefined && (source.type === "file" || source.type === "symbol")) {
    return source.path;
  }
  return undefined;
}

/** Extract short mime type label (e.g. "image/png" → "png", "text/plain" → "txt"). */
function mimeLabel(mime: string): string {
  const slash = mime.indexOf("/");
  const sub = slash >= 0 ? mime.slice(slash + 1) : mime;
  // Shorten common types
  if (sub === "plain") return "txt";
  if (sub === "javascript") return "js";
  if (sub === "typescript") return "ts";
  if (sub === "x-typescript") return "ts";
  if (sub === "x-javascript") return "js";
  if (sub === "x-sh") return "sh";
  if (sub === "x-python") return "py";
  if (sub === "x-rust") return "rs";
  return sub.length > 8 ? sub.slice(0, 6) + "…" : sub;
}

function dataUrl(value: string): string | undefined {
  return value.startsWith("data:") && value.includes(",") ? value : undefined;
}

/**
 * Resolves inline media without dereferencing arbitrary URLs. FilePart
 * responses may put the payload in source.text.value (raw base64 or a data
 * URL) or return a data URL directly in url.
 */
function inlineMediaUrl(part: FilePartData, kind: MimeKind): string | undefined {
  if (kind !== "image" && kind !== "video") return undefined;
  const sourceValue = part.source?.text?.value ?? "";
  const sourceDataUrl = dataUrl(sourceValue);
  if (sourceDataUrl !== undefined) return sourceDataUrl;
  if (sourceValue.length > 0) return `data:${part.mime};base64,${sourceValue}`;
  return dataUrl(part.url);
}

const FilePart: Component<FilePartProps> = (props) => {
  const t = useT();
  // Inline content lives in the part's source text; the 1.18.11 schema has
  // no separate content field on FilePart itself.
  const content = () => props.part.source?.text?.value ?? "";
  const kind = createMemo(() => mimeKind(props.part.mime));
  const mediaSrc = createMemo(() => inlineMediaUrl(props.part, kind()));
  const hasContent = createMemo(() => content().length > 0 || mediaSrc() !== undefined);
  const mimeLbl = createMemo(() => mimeLabel(props.part.mime));
  const displayName = createMemo(() => {
    const name = props.part.filename;
    if (name !== undefined && name.length > 0) return name;
    const urlName = basename(props.part.url);
    if (urlName.length > 0 && !urlName.startsWith("data:")) return urlName;
    return sourcePath(props.part.source) ?? "file";
  });
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div
      data-testid="file-part"
      data-mime-kind={kind()}
      class="my-1 overflow-hidden rounded-md bg-bg-sunken/50"
    >
      {/* IA-24: context entry header — file icon + path (monospace) + mime badge */}
      <button
        type="button"
        aria-expanded={expanded()}
        disabled={!hasContent()}
        class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs outline-none focus:bg-accent-soft disabled:cursor-default"
        onClick={() => setExpanded((value) => !value)}
      >
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
          {MIME_ICON[kind()]}
        </svg>
        <span class="min-w-0 flex-1 truncate font-code font-medium text-fg-primary">
          {displayName()}
        </span>
        {/* IA-24: mime type badge for quick identification */}
        <span
          class="shrink-0 rounded-sm bg-bg-elevated px-1 py-0.5 font-code text-[10px] text-fg-faint"
          aria-label={props.part.mime}
        >
          {mimeLbl()}
        </span>
        <Show when={!hasContent()}>
          <span data-testid="file-unavailable" class="shrink-0 text-fg-faint">
            {t("messages:fileContentUnavailable")}
          </span>
        </Show>
      </button>
      <Show when={hasContent() && expanded()}>
        <div data-testid="file-preview" class="border-t border-bg-sunken px-2 py-2">
          <Show when={kind() === "image" && mediaSrc() !== undefined}>
            <img
              data-testid="file-image"
              src={mediaSrc()}
              alt={displayName()}
              class="max-h-64 w-full rounded-sm object-contain bg-bg-elevated"
            />
          </Show>
          <Show when={kind() === "video" && mediaSrc() !== undefined}>
            <video
              data-testid="file-video"
              src={mediaSrc()}
              controls
              preload="metadata"
              class="max-h-64 w-full rounded-sm bg-bg-elevated"
            />
          </Show>
          <Show when={kind() !== "image" && kind() !== "video"}>
            <pre
              data-testid="file-text"
              class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-sm bg-bg-elevated px-2 py-1.5 font-code text-xs leading-relaxed text-fg-secondary"
            >
              {content()}
            </pre>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default FilePart;
