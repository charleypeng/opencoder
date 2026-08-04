// Attachment helpers (TASK-M3-08): the composer's attachment model and the
// pure mapping onto the schema's FilePartInput. `fileToAttachment` reads a
// dropped/pasted File into an attachment — images and large/binary files as
// base64 data URLs (the FilePartInput `url` carries the content), small
// text-like files as plain text (encoded into a data URL at part mapping
// time). `attachmentToPart` is pure so the send pipeline and its tests stay
// free of FileReader plumbing.

import type { components } from "../../services/api/schema.js";

export type FilePartInput = components["schemas"]["FilePartInput"];

/** Composer attachment: inline content (data URL or plain text) plus meta. */
export interface Attachment {
  id: string;
  kind: "file" | "image";
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
    url: attachment.content.startsWith("data:")
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

/** Reads a File into an attachment (see module doc for content formats). */
export function fileToAttachment(file: File): Promise<Attachment> {
  const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (file.type.startsWith("image/")) {
    return readAsDataURL(file).then((content) => ({
      id,
      kind: "image" as const,
      name: file.name || "pasted-image",
      mimeType: file.type || "image/png",
      content,
    }));
  }
  if (file.size <= TEXT_SIZE_LIMIT && isTextLike(file.type)) {
    return readAsText(file).then((content) => ({
      id,
      kind: "file" as const,
      name: file.name,
      mimeType: file.type || "text/plain",
      content,
    }));
  }
  return readAsDataURL(file).then((content) => ({
    id,
    kind: "file" as const,
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
