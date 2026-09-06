// Unified conversation-content icons (PROCESS-REF-05): one stroke style for
// every semantic icon in the chat transcript — tool summaries, attachment
// chips, and structured part titles. All glyphs are inline SVG on a 16×16
// grid with round caps, drawn in currentColor so theme tokens control the
// tone. The test-only specimen render (icons.specimen.test.tsx) mounts the
// exact same bodies.
//
// Mapping evidence rule: a tool alias enters the classification table only
// with repository evidence (mock fixtures or an existing classification
// regex); candidates without evidence (webfetch, skill, MCP tools) fall
// through to the generic tool glyph instead of being guessed.

export type IconKind =
  // structured part kinds
  | "text"
  | "reasoning"
  | "patch"
  | "snapshot"
  | "agent"
  | "subtask"
  | "retry"
  | "compaction"
  // tool kinds
  | "terminal"
  | "read"
  | "edit"
  | "write"
  | "glob"
  | "grep"
  | "question"
  | "todo"
  | "tool"
  // attachment kinds
  | "file"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "code"
  | "text-doc"
  | "archive";

import type { JSX } from "solid-js";

/**
 * Inner SVG elements for each icon kind. Stroke styling lives on the host
 * <svg> in ContentIcon so every glyph shares one stroke contract.
 */
export const ICON_BODY: Record<IconKind, JSX.Element> = {
  // Text lines / conversation outline (structured text titles only).
  text: (
    <>
      <path d="M3 4.5h10M3 8h10M3 11.5h6" />
    </>
  ),
  // Thought bubble outline ("View thought details" entry).
  reasoning: (
    <>
      <path d="M4.5 3.5h7A2 2 0 0 1 13.5 5.5v3a2 2 0 0 1-2 2H8l-2.8 2.3V10.5h-.7a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Z" />
    </>
  ),
  // File with plus/minus changes (patch titles).
  patch: (
    <>
      <path d="M5 3v10M3.5 4.5 5 3l1.5 1.5M11 3v10M12.5 11.5 11 13l-1.5-1.5" />
    </>
  ),
  // Stacked files / snapshot frame (snapshot entry).
  snapshot: (
    <>
      <rect x="2" y="4.5" width="12" height="9" rx="1.5" />
      <circle cx="8" cy="9" r="2.5" />
      <path d="M5.5 4.5 6.8 2.8h2.4l1.3 1.7" />
    </>
  ),
  // Compact robot outline (agent mention/chip).
  agent: (
    <>
      <rect x="2.5" y="5.5" width="11" height="7" rx="1.5" />
      <path d="M8 2.5v3M4.8 8.3h.01M7.5 8.3h.01M10.2 8.3h.01" />
    </>
  ),
  // Branch node (subtask titles).
  subtask: (
    <>
      <circle cx="5" cy="3" r="1.5" />
      <circle cx="5" cy="13" r="1.5" />
      <circle cx="11.5" cy="8" r="1.5" />
      <path d="M5 4.5v7M5 11a4.5 4.5 0 0 1 4.5-3h.5" />
    </>
  ),
  // Circular retry arrow (retry rows).
  retry: (
    <>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5V6h-3.5" />
    </>
  ),
  // Arrows folding inward (neutral compaction status).
  compaction: (
    <>
      <path d="M6.5 2.5v3h-3" />
      <path d="M9.5 2.5v3h3" />
      <path d="M6.5 13.5v-3h-3" />
      <path d="M9.5 13.5v-3h3" />
    </>
  ),
  // Small terminal box with a prompt, matching the reference screenshot.
  terminal: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="m4.5 6 2 2-2 2" />
      <path d="M8.5 10.5h3" />
    </>
  ),
  // Open book pages (read), distinct from attachment file glyphs.
  read: (
    <>
      <path d="M8 3.8C7 2.9 5.5 2.5 3.5 2.5A.9.9 0 0 0 2.5 3.4v8.2c0 .5.4.9.9.9 2 0 3.6.4 4.6 1.3 1-.9 2.6-1.3 4.6-1.3.5 0 .9-.4.9-.9V3.4a.9.9 0 0 0-1-.9c-2 0-3.5.4-4.5 1.3Z" />
      <path d="M8 3.8v10" />
    </>
  ),
  // Diagonal pencil (edit and verified patch-edit aliases).
  edit: (
    <>
      <path d="m11.2 2.6 2.2 2.2-7.5 7.5-2.9.7.7-2.9Z" />
      <path d="m9.7 4.1 2.2 2.2" />
    </>
  ),
  // File with a plus (write/create), distinct from edit.
  write: (
    <>
      <path d="M9.5 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V5.5Z" />
      <path d="M9.5 2v3.5H13" />
      <path d="M8 8v3.5M6.2 9.8h3.6" />
    </>
  ),
  // Folder with a magnifier (glob path search).
  glob: (
    <>
      <path d="M2 4a1 1 0 0 1 1-1h3.2l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />
      <circle cx="8" cy="9" r="1.8" />
      <path d="m9.3 10.3 1.6 1.6" />
    </>
  ),
  // Text lines under a magnifier (grep content search).
  grep: (
    <>
      <path d="M2.5 3.5h11M2.5 6.5h5" />
      <circle cx="8.5" cy="10" r="3" />
      <path d="m10.8 12.3 2.2 2.2" />
    </>
  ),
  // Chat bubble with a question mark (question tool).
  question: (
    <>
      <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11h-.5A1.5 1.5 0 0 1 3 9.5Z" />
      <path d="M6.6 6.2a1.5 1.5 0 0 1 2.9.5c0 1-1.5 1.1-1.5 2" />
      <path d="M8 10.4h.01" />
    </>
  ),
  // Checklist (todo/task tools; the chat transcript keeps hiding them in
  // the dedicated panel — mapping kept complete for the classification).
  todo: (
    <>
      <rect x="2.5" y="3" width="11" height="10.5" rx="1.5" />
      <path d="m4.8 8 1.4 1.4 2.4-2.6" />
      <path d="M10.5 8.5h1.5" />
      <path d="M4.8 11.5h4.2" />
    </>
  ),
  // Generic tool (unknown tools; the real tool name is always shown).
  tool: (
    <>
      <path d="M9.8 3.2a3 3 0 0 0-3.9 3.9L2.6 10.4a1.5 1.5 0 1 0 2.1 2.1l3.3-3.3a3 3 0 0 0 3.9-3.9L10 7.2 8.1 5.3Z" />
    </>
  ),
  // Dog-eared blank document (unknown attachments; replaces the old cube).
  file: (
    <>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6Z" />
      <path d="M9 2v4h4" />
    </>
  ),
  // Stacked photos (image attachments and image previews).
  image: (
    <>
      <rect x="4.5" y="2.5" width="9" height="7" rx="1.2" />
      <path d="M2.5 5.5v5.7A2.3 2.3 0 0 0 4.8 13.5h6.9" />
      <circle cx="7.2" cy="5" r=".9" />
      <path d="m5.5 9.5 2.2-2 2 1.7 1.6-1.5 1.7 1.8" />
    </>
  ),
  // Document with a play triangle (video type only; no new playback).
  video: (
    <>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6Z" />
      <path d="M9 2v4h4" />
      <path d="M7 8.2 9.5 9.7 7 11.2Z" />
    </>
  ),
  // Waveform document (audio type only; no playback).
  audio: (
    <>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6Z" />
      <path d="M9 2v4h4" />
      <path d="M5.2 10.2v-1.4M7 11.2V8M8.8 11.8V7.4M10.6 10.8V8.6" />
    </>
  ),
  // Folded-corner document (PDF attachments; no new renderer).
  pdf: (
    <>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6Z" />
      <path d="M9 2v4h4" />
      <path d="M5.5 11.5v-3h1a1 1 0 0 1 0 2h-1M10.5 8.5v3M10.5 10a1 1 0 0 1 0 1.5h-.8v-3h.8a1 1 0 0 1 0 1.5Z" />
    </>
  ),
  // Document with code brackets (known code MIME types).
  code: (
    <>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6Z" />
      <path d="M9 2v4h4" />
      <path d="m6.5 8.5-1.3 1.5 1.3 1.5M9.5 8.5l1.3 1.5-1.3 1.5" />
    </>
  ),
  // Plain text document (text/* without a code-specific type).
  "text-doc": (
    <>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6Z" />
      <path d="M9 2v4h4" />
      <path d="M5.5 8.5h5M5.5 11h3" />
    </>
  ),
  // Zipper document (well-identified archives only).
  archive: (
    <>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6Z" />
      <path d="M9 2v4h4" />
      <path d="M7 2.5v1.2M7 4.9v1.2M7 7.3v1.2" />
      <path d="M6.2 9.6h1.6v1.9a.8.8 0 0 1-1.6 0Z" />
    </>
  ),
};

export interface ContentIconProps {
  kind: IconKind;
  /** Extra classes for size/tone; the 16px slot itself never shrinks. */
  class?: string;
}

/**
 * One inline SVG drawn in currentColor inside a fixed 16px slot. Icons are
 * decorative: aria-hidden with focusable="false" for legacy WebKit, so the
 * adjacent text carries the meaning and the glyph never takes focus.
 */
export function ContentIcon(props: ContentIconProps) {
  return (
    <span
      aria-hidden="true"
      data-icon-kind={props.kind}
      class={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${props.class ?? ""}`}
    >
      {/* Legacy WebKit needs focusable="false"; the attr bypasses the typed
          SVG props, which have no such member. */}
      <svg
        {...{ focusable: "false" }}
        class="h-3.5 w-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {ICON_BODY[props.kind]}
      </svg>
    </span>
  );
}

/** Command tools: alias regex already used by the activity derivation. */
const COMMAND_TOOLS = /^(bash|shell|exec|terminal|command|run)$/i;
/** Verified patch-editing aliases (agentRun.ts FILE_TOOLS minus write/create). */
const EDIT_TOOLS = /^(edit|patch|apply_patch|multiedit|delete|move|rename)$/i;
/** Verified file-creation aliases. */
const WRITE_TOOLS = /^(write|create)$/i;
/** Panel-scoped planning tools; the transcript keeps filtering them out. */
const TODO_TOOLS = /^(todo|task)/i;

/** Maps a tool name to its icon kind; unknown tools get the generic glyph. */
export function toolIconKind(tool: string): IconKind {
  const name = tool.trim();
  if (COMMAND_TOOLS.test(name)) return "terminal";
  if (/^read$/i.test(name)) return "read";
  if (EDIT_TOOLS.test(name)) return "edit";
  if (WRITE_TOOLS.test(name)) return "write";
  if (/^glob$/i.test(name)) return "glob";
  if (/^grep$/i.test(name)) return "grep";
  if (/^question$/i.test(name)) return "question";
  if (TODO_TOOLS.test(name)) return "todo";
  return "tool";
}

const ARCHIVE_MIMES =
  /^(application\/(zip|gzip|x-tar|x-7z-compressed|x-rar-compressed|vnd.rar|x-archive)|application\/x-compress)$/i;
const CODE_MIMES =
  /^(application\/(json|xml|javascript|typescript|x-sh|x-python|x-rust|x-httpd-php|sql|yaml|toml)|text\/(javascript|typescript|x-sh))$/i;
const PDF_MIME = /^application\/pdf$/i;

const CODE_EXTENSIONS =
  /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx|json|jsonc|xml|yaml|yml|toml|sql|sh|bash|zsh|py|rb|rs|go|java|kt|swift|c|h|cpp|hpp|cs|php|css|scss|html|htm)$/i;
const ARCHIVE_EXTENSIONS = /\.(zip|gz|tgz|tar|7z|rar)$/i;
const PDF_EXTENSION = /\.pdf$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv|avi|m4v)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;

/**
 * Maps an attachment to its icon kind. Explicit MIME wins; the filename
 * extension is only consulted when the MIME is missing, blank, or a generic
 * octet-stream, and never overrides a concrete type. Extension matching
 * strips any query/hash first. Classification is icon-only: it never changes
 * URL safety, previews, or downloads.
 */
export function attachmentIconKind(
  mime: string | undefined,
  filename: string | undefined,
): IconKind {
  const type = mime?.trim() ?? "";
  if (type !== "" && !/^application\/octet-stream$/i.test(type)) {
    if (/^image\//i.test(type)) return "image";
    if (/^video\//i.test(type)) return "video";
    if (/^audio\//i.test(type)) return "audio";
    if (PDF_MIME.test(type)) return "pdf";
    if (ARCHIVE_MIMES.test(type)) return "archive";
    if (CODE_MIMES.test(type)) return "code";
    if (/^text\//i.test(type)) return "text-doc";
    return "file";
  }
  // MIME is absent or generic: fall back to a reliable extension only.
  const name = (filename ?? "").split(/[?#]/, 1)[0] ?? "";
  if (PDF_EXTENSION.test(name)) return "pdf";
  if (ARCHIVE_EXTENSIONS.test(name)) return "archive";
  if (CODE_EXTENSIONS.test(name)) return "code";
  if (IMAGE_EXTENSIONS.test(name)) return "image";
  if (VIDEO_EXTENSIONS.test(name)) return "video";
  if (AUDIO_EXTENSIONS.test(name)) return "audio";
  return "file";
}
