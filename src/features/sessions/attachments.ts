// Attachment helpers (TASK-M3-08): the composer's attachment model and the
// pure mapping onto the schema's FilePartInput. `fileToAttachment` reads a
// dropped/pasted File into an attachment — images and large/binary files as
// base64 data URLs (the FilePartInput `url` carries the content), small
// text-like files as plain text (encoded into a data URL at part mapping
// time). Files over `MAX_ATTACHMENT_BYTES` are rejected before any read so a
// huge drop never becomes an unbounded in-memory data URL or request body.
// The `kind` flag records the content format explicitly (a raw text file
// starting with "data:" is never mistaken for an already-encoded data URL).
// `attachmentToPart` is pure so the send pipeline and its tests stay free
// of FileReader plumbing.

import type { components } from "../../services/api/schema.js";

export type FilePartInput = components["schemas"]["FilePartInput"];

/** Largest accepted attachment: 50MB (base64 in memory + request body). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Composer attachment: inline content (data URL or plain text) plus meta. */
export interface Attachment {
  id: string;
  /** Visual category: image chip vs plain file chip. */
  category: "file" | "image";
  /** Content format: base64 data URL or raw text (encoded at part mapping). */
  kind: "data-url" | "text";
  name: string;
  mimeType: string;
  /** Base64 data URL for images/binary, raw text for small text files. */
  content: string;
  /** On-disk path, when the file came with one (Tauri drag-drop events). */
  path?: string;
}

const TEXT_SIZE_LIMIT = 512 * 1024;

function isTextLike(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType === "application/typescript"
  );
}

/** Maps an attachment onto the FilePartInput the prompt API expects. */
export function attachmentToPart(attachment: Attachment): FilePartInput {
  const part: FilePartInput = {
    type: "file",
    mime: attachment.mimeType,
    filename: attachment.name,
    url:
      attachment.kind === "data-url"
        ? attachment.content
        : `data:${attachment.mimeType || "text/plain"};charset=utf-8,${encodeURIComponent(
            attachment.content,
          )}`,
  };
  if (attachment.path !== undefined) {
    part.source = {
      type: "file",
      path: attachment.path,
      text: { value: "", start: 0, end: 0 },
    };
  }
  return part;
}

/**
 * Reads a File into an attachment (see module doc for content formats).
 * Rejects files over `MAX_ATTACHMENT_BYTES`.
 */
export async function fileToAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `File too large: ${file.name} exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit`,
    );
  }
  const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (file.type.startsWith("image/")) {
    return readAsDataURL(file).then((content) => ({
      id,
      category: "image" as const,
      kind: "data-url" as const,
      name: file.name || "pasted-image",
      mimeType: file.type || "image/png",
      content,
    }));
  }
  if (file.size <= TEXT_SIZE_LIMIT && isTextLike(file.type)) {
    return readAsText(file).then((content) => ({
      id,
      category: "file" as const,
      kind: "text" as const,
      name: file.name,
      mimeType: file.type || "text/plain",
      content,
    }));
  }
  return readAsDataURL(file).then((content) => ({
    id,
    category: "file" as const,
    kind: "data-url" as const,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    content,
  }));
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
