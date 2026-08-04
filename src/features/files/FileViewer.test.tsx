// L2 tests for the file viewer (TASK-M4-03): the editor-style tab bar
// (open/close/activate from the viewer store), the content branches —
// Shiki-highlighted text (language from the extension, mocked highlighter),
// images (base64 data URL / pass-through data: content), unified diffs and
// patches (colored add/del/hunk/meta rows), the binary note and the empty
// file note — plus loading, error + retry, per-tab caching (re-activating a
// cached tab never refetches) and tab switching preserving content.
//
// Every test uses a fresh server id: the viewer's content cache is module
// level, so unique ids keep one test's cached payloads from short-circuiting
// another test's fetches.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { ApiClient, type Transport } from "../../services/client";
import { resetServer, openTab, setActive } from "../../stores/viewer";
import FileViewer, { type FileViewerProps } from "./FileViewer";

const { getApiClientMock, highlightMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  highlightMock: vi.fn(),
}));

vi.mock("../../services/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/client.js")>();
  return { ...actual, getApiClient: getApiClientMock };
});

vi.mock("../messages/markdown/highlighter.js", () => ({
  getHighlighter: vi.fn(),
  highlightCode: highlightMock,
}));

let serverSeq = 0;
/** Unique per-test server id (isolates the module-level content cache). */
function freshServer(): string {
  return `srv-viewer-${++serverSeq}`;
}

function textContent(content: string, mimeType = "text/plain"): unknown {
  return { type: "text", content, mimeType };
}

function httpResponse(body: unknown) {
  return { status: 200, headers: {}, body, bodyText: undefined };
}

/** Injects a client whose transport records every /file/content call and
 *  answers per-path from `contentByPath` (a function or a record). */
function mountViewer(
  serverId: string,
  contentByPath: Record<string, unknown> | ((path: string) => unknown) = {},
  props: Partial<FileViewerProps> = {},
): ReturnType<typeof vi.fn> {
  const requestMock = vi
    .fn()
    .mockImplementation((input: { path: string; query?: Record<string, string> }) => {
      if (input.path !== "/file/content") return Promise.resolve(httpResponse(undefined));
      const path = input.query?.path ?? "";
      const body =
        typeof contentByPath === "function"
          ? contentByPath(path)
          : (contentByPath[path] ?? undefined);
      return Promise.resolve(httpResponse(body));
    });
  const transport: Transport = {
    request: requestMock as unknown as Transport["request"],
  };
  getApiClientMock.mockReturnValue(new ApiClient(transport));
  render(() => <FileViewer serverId={serverId} {...props} />);
  return requestMock;
}

function contentCalls(requestMock: ReturnType<typeof vi.fn>, path: string): number {
  return requestMock.mock.calls.filter(
    (call) =>
      (call[0] as { path: string }).path === "/file/content" &&
      (call[0] as { query?: Record<string, string> }).query?.path === path,
  ).length;
}

beforeEach(() => {
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue(new ApiClient({ request: vi.fn() }));
  highlightMock.mockReset();
  highlightMock.mockImplementation(async (code: string) => `<pre data-testid="hl">${code}</pre>`);
});

afterEach(() => {
  // The unique ids are untracked; clear any that got created (keeps the
  // viewer store from growing across the file).
  for (let i = 1; i <= serverSeq; i += 1) resetServer(`srv-viewer-${i}`);
});

describe("FileViewer tab bar", () => {
  it("shows the empty state with no open tabs", () => {
    const serverId = freshServer();
    mountViewer(serverId);
    expect(screen.getByTestId("file-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("viewer-empty")).toBeInTheDocument();
    expect(screen.getByText("No file open")).toBeInTheDocument();
  });

  it("renders open tabs, highlights the active one and switches on click", async () => {
    const serverId = freshServer();
    mountViewer(serverId);
    openTab(serverId, "src/a.ts");
    openTab(serverId, "README.md");
    await waitFor(() => expect(screen.getByTestId("viewer-tab-src/a.ts")).toBeInTheDocument());

    const tabA = screen.getByTestId("viewer-tab-src/a.ts");
    const tabB = screen.getByTestId("viewer-tab-README.md");
    // The most recently opened tab is active.
    expect(tabB).toHaveAttribute("aria-selected", "true");
    expect(tabA).toHaveAttribute("aria-selected", "false");
    expect(tabA).toHaveTextContent("a.ts");
    expect(tabB).toHaveTextContent("README.md");
    expect(tabB).toHaveAttribute("title", "README.md");

    fireEvent.click(tabA);
    await waitFor(() => expect(tabA).toHaveAttribute("aria-selected", "true"));
    expect(tabB).toHaveAttribute("aria-selected", "false");
  });

  it("closes a tab from its close button and activates the neighbor", async () => {
    const serverId = freshServer();
    mountViewer(serverId);
    openTab(serverId, "src/a.ts");
    openTab(serverId, "src/b.ts");
    openTab(serverId, "src/c.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-tab-src/c.ts")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("viewer-tab-close-src/c.ts"));
    await waitFor(() =>
      expect(screen.queryByTestId("viewer-tab-src/c.ts")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("viewer-tab-src/b.ts")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByTestId("viewer-tab-close-src/b.ts"));
    fireEvent.click(screen.getByTestId("viewer-tab-close-src/a.ts"));
    await waitFor(() => expect(screen.getByTestId("viewer-empty")).toBeInTheDocument());
  });
});

describe("FileViewer content branches", () => {
  it("highlights text content with the language from the extension", async () => {
    const serverId = freshServer();
    mountViewer(serverId, {
      "src/a.ts": textContent("const x = 1;\n", "text/typescript"),
    });
    openTab(serverId, "src/a.ts");

    await waitFor(() =>
      expect(screen.getByTestId("viewer-code")).toHaveTextContent("const x = 1;"),
    );
    expect(highlightMock).toHaveBeenCalledWith("const x = 1;\n", "typescript");
  });

  it("falls back to a plain escaped block when highlighting fails", async () => {
    highlightMock.mockRejectedValue(new Error("no shiki"));
    const serverId = freshServer();
    mountViewer(serverId, { "src/a.ts": textContent("const <x> = 1;\n") });
    openTab(serverId, "src/a.ts");

    // The raw content survives the fallback as literal text, never as HTML.
    await waitFor(() =>
      expect(screen.getByTestId("viewer-code")).toHaveTextContent("const <x> = 1;"),
    );
    expect(screen.getByTestId("viewer-code").querySelector("code")?.textContent).toContain(
      "const <x> = 1;",
    );
  });

  it("renders an empty-file note for empty text content", async () => {
    const serverId = freshServer();
    mountViewer(serverId, { "src/empty.txt": textContent("") });
    openTab(serverId, "src/empty.txt");
    await waitFor(() => expect(screen.getByTestId("viewer-empty-file")).toBeInTheDocument());
    expect(highlightMock).not.toHaveBeenCalled();
  });

  it("renders a base64 image from the mimeType + encoding", async () => {
    const serverId = freshServer();
    mountViewer(serverId, {
      "logo.png": {
        type: "binary",
        content: "iVBORw0KGgo=",
        encoding: "base64",
        mimeType: "image/png",
      },
    });
    openTab(serverId, "logo.png");

    await waitFor(() => expect(screen.getByTestId("viewer-image")).toBeInTheDocument());
    expect(screen.getByTestId("viewer-image")).toHaveAttribute(
      "src",
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect(screen.getByTestId("viewer-image")).toHaveAttribute("alt", "logo.png");
  });

  it("passes through a data: image content untouched", async () => {
    const serverId = freshServer();
    mountViewer(serverId, {
      "logo.svg": {
        type: "text",
        content: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        mimeType: "text/plain",
      },
    });
    openTab(serverId, "logo.svg");

    await waitFor(() => expect(screen.getByTestId("viewer-image")).toBeInTheDocument());
    expect(screen.getByTestId("viewer-image")).toHaveAttribute(
      "src",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    );
  });

  it("shows the binary note for non-image binary payloads", async () => {
    const serverId = freshServer();
    mountViewer(serverId, {
      "blob.bin": {
        type: "binary",
        content: "AAECAw==",
        encoding: "base64",
        mimeType: "application/octet-stream",
      },
    });
    openTab(serverId, "blob.bin");
    await waitFor(() => expect(screen.getByTestId("viewer-binary")).toBeInTheDocument());
    expect(screen.getByTestId("viewer-binary")).toHaveTextContent("Binary file");
    expect(highlightMock).not.toHaveBeenCalled();
  });

  it("colors unified diff rows by kind", async () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1234567..89abcde 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " const x = 1;",
      "-const y = 2;",
      "+const y = 3;",
      "+const z = 4;",
    ].join("\n");
    const serverId = freshServer();
    mountViewer(serverId, { "src/a.ts": textContent(diff, "text/x-diff") });
    openTab(serverId, "src/a.ts");

    await waitFor(() => expect(screen.getByTestId("viewer-diff")).toBeInTheDocument());
    const rows = screen.getAllByTestId("viewer-diff-row");
    expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual([
      "meta",
      "meta",
      "meta",
      "meta",
      "hunk",
      "ctx",
      "del",
      "add",
      "add",
    ]);
    expect(rows[6]).toHaveClass("bg-danger/15", "text-danger");
    expect(rows[7]).toHaveClass("bg-success/15", "text-success");
    expect(rows[6]).toHaveTextContent("-const y = 2;");
    expect(rows[7]).toHaveTextContent("+const y = 3;");
  });

  it("detects a patch by content prefix without a diff mime", async () => {
    const serverId = freshServer();
    mountViewer(serverId, {
      "src/a.ts": textContent("--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n"),
    });
    openTab(serverId, "src/a.ts");

    await waitFor(() => expect(screen.getByTestId("viewer-diff")).toBeInTheDocument());
    expect(highlightMock).not.toHaveBeenCalled();
  });

  it("renders structured patch hunks as diff rows", async () => {
    const serverId = freshServer();
    mountViewer(serverId, {
      "src/a.ts": {
        type: "text",
        content: "ignored body",
        patch: {
          oldFileName: "src/a.ts",
          newFileName: "src/a.ts",
          hunks: [
            {
              oldStart: 1,
              oldLines: 2,
              newStart: 1,
              newLines: 2,
              lines: [" old", "-gone", "+added"],
            },
          ],
        },
      },
    });
    openTab(serverId, "src/a.ts");

    await waitFor(() => expect(screen.getByTestId("viewer-diff")).toBeInTheDocument());
    const rows = screen.getAllByTestId("viewer-diff-row");
    expect(rows[0]).toHaveAttribute("data-kind", "hunk");
    expect(rows[0]).toHaveTextContent("@@ -1,2 +1,2 @@");
    expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual(["hunk", "ctx", "del", "add"]);
  });
});

describe("FileViewer fetch states", () => {
  it("shows a loading state while the content fetch is in flight", async () => {
    let resolve: ((value: unknown) => void) | undefined;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const requestMock = vi
      .fn()
      .mockImplementation((input: { path: string }) =>
        input.path === "/file/content" ? pending : Promise.resolve(httpResponse(undefined)),
      );
    const transport: Transport = {
      request: requestMock as unknown as Transport["request"],
    };
    const serverId = freshServer();
    getApiClientMock.mockReturnValue(new ApiClient(transport));
    render(() => <FileViewer serverId={serverId} />);
    openTab(serverId, "src/a.ts");

    await waitFor(() => expect(screen.getByTestId("viewer-loading")).toBeInTheDocument());
    resolve!(httpResponse(textContent("const x = 1;\n")));
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toBeInTheDocument());
    expect(screen.queryByTestId("viewer-loading")).not.toBeInTheDocument();
  });

  it("renders the error banner and retries the fetch", async () => {
    let fail = true;
    const serverId = freshServer();
    mountViewer(serverId, (path) => {
      if (fail) throw new Error("boom");
      return textContent(`content of ${path}`);
    });
    openTab(serverId, "src/a.ts");

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.queryByTestId("viewer-code")).not.toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByTestId("viewer-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("viewer-code")).toHaveTextContent("content of src/a.ts"),
    );
    expect(highlightMock).toHaveBeenCalledWith("content of src/a.ts", "typescript");
  });

  it("caches per tab: switching back never refetches and keeps content", async () => {
    const serverId = freshServer();
    const requestMock = mountViewer(serverId, {
      "src/a.ts": textContent("alpha"),
      "src/b.ts": textContent("beta"),
    });
    openTab(serverId, "src/a.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toHaveTextContent("alpha"));
    expect(contentCalls(requestMock, "src/a.ts")).toBe(1);

    openTab(serverId, "src/b.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toHaveTextContent("beta"));
    expect(contentCalls(requestMock, "src/b.ts")).toBe(1);

    // Back to the first tab: cached, no second request, content intact.
    setActive(serverId, "src/a.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toHaveTextContent("alpha"));
    expect(contentCalls(requestMock, "src/a.ts")).toBe(1);
    expect(screen.queryByTestId("viewer-loading")).not.toBeInTheDocument();
  });

  it("opening the same file again does not refetch (already open)", async () => {
    const serverId = freshServer();
    const requestMock = mountViewer(serverId, { "src/a.ts": textContent("alpha") });
    openTab(serverId, "src/a.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toHaveTextContent("alpha"));
    openTab(serverId, "src/a.ts");
    expect(contentCalls(requestMock, "src/a.ts")).toBe(1);
  });
});
