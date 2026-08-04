// L1 tests for the attachment helpers (TASK-M3-08): `fileToAttachment`
// turns a dropped/pasted File into a typed attachment (images read as
// base64 data URLs, small text-like files as plain text, anything else as a
// data URL), and `attachmentToPart` maps an attachment onto the schema's
// FilePartInput — data URLs pass through as the `url`, plain text is
// encoded into one, and an optional on-disk path becomes a FileSource.

import { describe, expect, it } from "vitest";
import { attachmentToPart, fileToAttachment } from "./attachments.js";

describe("attachmentToPart", () => {
  it("maps an image attachment onto a FilePartInput with its data URL", () => {
    const part = attachmentToPart({
      id: "att-1",
      kind: "image",
      name: "clip.png",
      mimeType: "image/png",
      content: "data:image/png;base64,aGVsbG8=",
    });

    expect(part).toEqual({
      type: "file",
      mime: "image/png",
      filename: "clip.png",
      url: "data:image/png;base64,aGVsbG8=",
    });
  });

  it("encodes plain text file content into a utf-8 data URL", () => {
    const part = attachmentToPart({
      id: "att-2",
      kind: "file",
      name: "notes.txt",
      mimeType: "text/plain",
      content: "hello\nworld",
    });

    expect(part.type).toBe("file");
    expect(part.mime).toBe("text/plain");
    expect(part.filename).toBe("notes.txt");
    expect(part.url).toBe("data:text/plain;charset=utf-8,hello%0Aworld");
  });

  it("attaches the FileSource when the attachment carries an on-disk path", () => {
    const part = attachmentToPart({
      id: "att-3",
      kind: "file",
      name: "main.ts",
      mimeType: "text/typescript",
      content: "export {}",
      path: "/mock/projects/opencode-demo/src/main.ts",
    });

    expect(part.source).toEqual({
      type: "file",
      path: "/mock/projects/opencode-demo/src/main.ts",
      text: { value: "", start: 0, end: 0 },
    });
  });
});

describe("fileToAttachment", () => {
  it("reads an image file as a base64 data URL attachment", async () => {
    const file = new File(["hello"], "clip.png", { type: "image/png" });

    const attachment = await fileToAttachment(file);

    expect(attachment).toMatchObject({ kind: "image", name: "clip.png", mimeType: "image/png" });
    expect(attachment.content.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("reads a small text file as plain text content", async () => {
    const file = new File(["line one\nline two"], "notes.txt", { type: "text/plain" });

    const attachment = await fileToAttachment(file);

    expect(attachment).toMatchObject({ kind: "file", name: "notes.txt", mimeType: "text/plain" });
    expect(attachment.content).toBe("line one\nline two");
  });

  it("reads a large binary file as a data URL without choking on text decoding", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const file = new File([bytes], "blob.bin", { type: "application/octet-stream" });

    const attachment = await fileToAttachment(file);

    expect(attachment).toMatchObject({ kind: "file", name: "blob.bin" });
    expect(attachment.content.startsWith("data:application/octet-stream;base64,")).toBe(true);
  });
});
