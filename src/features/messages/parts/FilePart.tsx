// File attachment card (TASK-M3-02): renders a FilePart as an attachment
// chip — mime-derived icon (image/text/generic file), file name (falling
// back to the URL or source path basename) and, when the part carries
// inline content in `source.text.value`, a click-to-expand preview
// (image mime renders the content as a base64 data URL, anything else as
// a text block). Remote URLs are NEVER loaded: the preview only reads
// inline content from the part itself; without content the chip shows a
// "Content unavailable" note and stays non-expandable.
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

type MimeKind = "image" | "text" | "other";

function mimeKind(mime: string): MimeKind {
  if (mime.startsWith("image/")) return "image";
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

const FilePart: Component<FilePartProps> = (props) => {
  const t = useT();
  // Inline content lives in the part's source text; the 1.18.11 schema has
  // no separate content field on FilePart itself.
  const content = () => props.part.source?.text?.value ?? "";
  const hasContent = createMemo(() => content().length > 0);
  const kind = createMemo(() => mimeKind(props.part.mime));
  const mimeLbl = createMemo(() => mimeLabel(props.part.mime));
  const displayName = createMemo(
    () =>
      props.part.filename ?? basename(props.part.url) ?? sourcePath(props.part.source) ?? "file",
  );
  const [expanded, setExpanded] = createSignal(false);

  // Images arrive base64-encoded (the schema has no encoding flag), so the
  // preview rebuilds them as data URLs; text content is shown as-is.
  const imageSrc = createMemo(() => `data:${props.part.mime};base64,${content()}`);

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
        class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs outline-none hover:bg-accent-soft focus:bg-accent-soft disabled:cursor-default disabled:hover:bg-transparent"
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
          <Show
            when={kind() === "image"}
            fallback={
              <pre
                data-testid="file-text"
                class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-sm bg-bg-elevated px-2 py-1.5 font-code text-xs leading-relaxed text-fg-secondary"
              >
                {content()}
              </pre>
            }
          >
            <img
              data-testid="file-image"
              src={imageSrc()}
              alt={displayName()}
              class="max-h-64 w-full rounded-sm object-contain bg-bg-elevated"
            />
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default FilePart;
