// L1 tests for the attachment helpers (TASK-M3-08): `fileToAttachment`
// turns a dropped/pasted File into a typed attachment (images read as
// base64 data URLs, small text-like files as plain text, anything else as a
// data URL), and `attachmentToPart` maps an attachment onto the schema's
// FilePartInput — data URLs pass through as the `url`, plain text is
// encoded into one, and an optional on-disk path becomes a FileSource. The
// `kind` flag ("data-url" | "text") records the content format explicitly so
// a text file whose content starts with "data:" is never mistaken for an
// already-encoded data URL. Files over `MAX_ATTACHMENT_BYTES` are rejected.

import { describe, expect, it } from "vitest";
import { attachmentToPart, fileToAttachment, MAX_ATTACHMENT_BYTES } from "./attachments.js";

describe("attachmentToPart", () => {
  it("maps an image attachment onto a FilePartInput with its data URL", () => {
    const part = attachmentToPart({
      id: "att-1",
      category: "image",
      kind: "data-url",
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

  it("maps a video attachment onto a FilePartInput with its data URL", () => {
    const part = attachmentToPart({
      id: "att-video",
      category: "video",
      kind: "data-url",
      name: "clip.mp4",
      mimeType: "video/mp4",
      content: "data:video/mp4;base64,aGVsbG8=",
    });

    expect(part).toMatchObject({
      type: "file",
      mime: "video/mp4",
      filename: "clip.mp4",
      url: "data:video/mp4;base64,aGVsbG8=",
    });
  });

  it("encodes plain text file content into a utf-8 data URL", () => {
    const part = attachmentToPart({
      id: "att-2",
      category: "file",
      kind: "text",
      name: "notes.txt",
      mimeType: "text/plain",
      content: "hello\nworld",
    });

    expect(part.type).toBe("file");
    expect(part.mime).toBe("text/plain");
    expect(part.filename).toBe("notes.txt");
    expect(part.url).toBe("data:text/plain;charset=utf-8,hello%0Aworld");
  });

  it("encodes text content starting with `data:` instead of passing it through", () => {
    const part = attachmentToPart({
      id: "att-4",
      category: "file",
      kind: "text",
      name: "odd.txt",
      mimeType: "text/plain",
      content: "data:not-a-url",
    });

    expect(part.url).toBe("data:text/plain;charset=utf-8,data%3Anot-a-url");
  });

  it("attaches the FileSource when the attachment carries an on-disk path", () => {
    const part = attachmentToPart({
      id: "att-3",
      category: "file",
      kind: "text",
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

    expect(attachment).toMatchObject({
      category: "image",
      kind: "data-url",
      name: "clip.png",
      mimeType: "image/png",
    });
    expect(attachment.content.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("reads a video file as a base64 data URL attachment", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });

    const attachment = await fileToAttachment(file);

    expect(attachment).toMatchObject({
      category: "video",
      kind: "data-url",
      name: "clip.mp4",
      mimeType: "video/mp4",
    });
    expect(attachment.content.startsWith("data:video/mp4;base64,")).toBe(true);
  });

  it("infers media mime types when a picker omits File.type", async () => {
    const file = new File(["video"], "clip.webm");

    const attachment = await fileToAttachment(file);

    expect(attachment.category).toBe("video");
    expect(attachment.mimeType).toBe("video/webm");
  });

  it("reads a small text file as plain text content", async () => {
    const file = new File(["line one\nline two"], "notes.txt", { type: "text/plain" });

    const attachment = await fileToAttachment(file);

    expect(attachment).toMatchObject({
      category: "file",
      kind: "text",
      name: "notes.txt",
      mimeType: "text/plain",
    });
    expect(attachment.content).toBe("line one\nline two");
  });

  it("keeps a text file whose content starts with `data:` as plain text", async () => {
    const file = new File(["data:not-a-url"], "odd.txt", { type: "text/plain" });

    const attachment = await fileToAttachment(file);

    expect(attachment.kind).toBe("text");
    expect(attachmentToPart(attachment).url).toBe("data:text/plain;charset=utf-8,data%3Anot-a-url");
  });

  it("reads a large binary file as a data URL without choking on text decoding", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const file = new File([bytes], "blob.bin", { type: "application/octet-stream" });

    const attachment = await fileToAttachment(file);

    expect(attachment).toMatchObject({ category: "file", kind: "data-url", name: "blob.bin" });
    expect(attachment.content.startsWith("data:application/octet-stream;base64,")).toBe(true);
  });

  it("rejects a file over the attachment size limit", async () => {
    const huge = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    const file = new File([huge], "huge.bin", { type: "application/octet-stream" });

    await expect(fileToAttachment(file)).rejects.toThrow(/too large/i);
  });
});
