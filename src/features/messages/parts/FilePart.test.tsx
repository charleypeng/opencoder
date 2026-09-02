// L2 tests for the file part (TASK-M3-02): mime-driven icon kind, filename
// fallback to the URL basename, click-to-expand previews (base64 image data
// URL / text block) and the no-content state (non-expandable "Content
// unavailable" chip), plus a snapshot of the fixture's file part.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import FilePart, { type FilePartData } from "./FilePart";
import allPartsFixtureJson from "../../../../tests/fixtures/message.stream.all-parts.json";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const VIDEO_BASE64 = "dmlkZW8=";

function filePart(overrides: Partial<FilePartData>): FilePartData {
  return {
    id: "prt_file",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "file",
    mime: "text/plain",
    filename: "notes.txt",
    url: "file:///project/notes.txt",
    ...overrides,
  } as FilePartData;
}

function withContent(value: string) {
  return {
    source: { type: "file", path: "notes.txt", text: { value, start: 0, end: 0 } },
  } as const;
}

describe("FilePart", () => {
  it("shows a mime-derived icon kind, filename and unavailable note without content", () => {
    render(() => (
      <FilePart
        part={filePart({
          mime: "image/png",
          filename: "login-flow.png",
          url: "file:///home/user/project/docs/login-flow.png",
        })}
      />
    ));
    const chip = screen.getByTestId("file-part");
    expect(chip).toHaveAttribute("data-mime-kind", "image");
    expect(chip).toHaveTextContent("login-flow.png");
    expect(chip).toHaveTextContent("Content unavailable");
    expect(chip.querySelector("button")).toBeDisabled();
  });

  it("falls back to the URL basename when no filename is given", () => {
    render(() => (
      <FilePart
        part={filePart({
          filename: undefined,
          url: "file:///home/user/project/docs/login-flow.png",
        })}
      />
    ));
    expect(screen.getByTestId("file-part")).toHaveTextContent("login-flow.png");
  });

  it("maps text/* and other mimes to their icon kinds", () => {
    const first = render(() => <FilePart part={filePart({ mime: "text/markdown" })} />);
    expect(screen.getByTestId("file-part")).toHaveAttribute("data-mime-kind", "text");
    first.unmount();

    render(() => <FilePart part={filePart({ mime: "application/pdf" })} />);
    expect(screen.getByTestId("file-part")).toHaveAttribute("data-mime-kind", "other");
  });

  it("expands image content into a base64 data-URL preview", () => {
    render(() => (
      <FilePart
        part={filePart({ mime: "image/png", ...withContent(PNG_BASE64) } as FilePartData)}
      />
    ));
    const button = screen.getByTestId("file-part").querySelector("button") as HTMLButtonElement;
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("file-preview")).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const image = screen.getByTestId("file-image") as HTMLImageElement;
    expect(image.src).toBe(`data:image/png;base64,${PNG_BASE64}`);
    expect(image.alt).toBe("notes.txt");
  });

  it("expands text content into a collapsible text preview", () => {
    render(() => (
      <FilePart
        part={filePart({
          mime: "text/plain",
          ...withContent("line one\nline two"),
        } as FilePartData)}
      />
    ));
    expect(screen.queryByTestId("file-text")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("file-part").querySelector("button") as HTMLButtonElement);
    const pre = screen.getByTestId("file-text");
    expect(pre.textContent).toBe("line one\nline two");
  });

  it("expands video content into a native media preview", () => {
    render(() => (
      <FilePart
        part={filePart({
          mime: "video/mp4",
          filename: "clip.mp4",
          ...withContent(VIDEO_BASE64),
        } as FilePartData)}
      />
    ));

    const chip = screen.getByTestId("file-part");
    expect(chip).toHaveAttribute("data-mime-kind", "video");
    fireEvent.click(chip.querySelector("button") as HTMLButtonElement);
    const video = screen.getByTestId("file-video") as HTMLVideoElement;
    expect(video.src).toBe(`data:video/mp4;base64,${VIDEO_BASE64}`);
    expect(video.controls).toBe(true);
  });

  it("accepts a data URL in the API url field without loading remote URLs", () => {
    render(() => (
      <FilePart
        part={filePart({
          mime: "image/png",
          filename: "inline.png",
          url: `data:image/png;base64,${PNG_BASE64}`,
          source: undefined,
        })}
      />
    ));

    const chip = screen.getByTestId("file-part");
    expect(chip.querySelector("button")).not.toBeDisabled();
    fireEvent.click(chip.querySelector("button") as HTMLButtonElement);
    expect(screen.getByTestId("file-image")).toHaveAttribute(
      "src",
      `data:image/png;base64,${PNG_BASE64}`,
    );
  });

  it("does not render an external media URL", () => {
    render(() => (
      <FilePart
        part={filePart({
          mime: "video/mp4",
          filename: "remote.mp4",
          url: "https://example.test/remote.mp4",
          source: undefined,
        })}
      />
    ));

    expect(screen.getByTestId("file-part")).toHaveAttribute("data-mime-kind", "video");
    expect(screen.getByTestId("file-part").querySelector("button")).toBeDisabled();
    expect(screen.queryByTestId("file-video")).not.toBeInTheDocument();
  });

  it("never expands when the part has no inline content", () => {
    render(() => <FilePart part={filePart({ source: undefined })} />);
    expect(screen.getByTestId("file-part")).toHaveTextContent("Content unavailable");
    fireEvent.click(screen.getByTestId("file-part").querySelector("button") as HTMLButtonElement);
    expect(screen.queryByTestId("file-preview")).not.toBeInTheDocument();
  });
});

describe("FilePart snapshot", () => {
  it("matches the fixture's file part (no inline content)", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p6") as
      FilePartData | undefined;
    expect(fixturePart).toBeDefined();
    const { container } = render(() => <FilePart part={fixturePart as FilePartData} />);
    expect(container).toMatchSnapshot();
  });
});
