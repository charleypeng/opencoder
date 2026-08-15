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
import { createSignal } from "solid-js";
import { ApiClient, type Transport } from "../../services/client";
import { resetServer, openTab, setActive, setActiveLine, viewer } from "../../stores/viewer";
import { setCurrent, resetServer as resetProjects } from "../../stores/project";
import { setActiveServer } from "../../stores/registry";
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
  for (let i = 1; i <= serverSeq; i += 1) {
    resetServer(`srv-viewer-${i}`);
    resetProjects(`srv-viewer-${i}`);
  }
  setActiveServer(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
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
  it("renders markdown by default and switches to source from the tab menu", async () => {
    const serverId = freshServer();
    mountViewer(serverId, {
      "docs/preview.md": textContent("# Preview\n\n**formatted**", "text/markdown"),
    });
    openTab(serverId, "docs/preview.md");

    await waitFor(() => expect(screen.getByTestId("viewer-markdown")).toBeInTheDocument());
    expect(screen.getByTestId("viewer-markdown")).toHaveTextContent("Preview");

    fireEvent.contextMenu(screen.getByTestId("viewer-tab-docs/preview.md"), {
      clientX: 100,
      clientY: 80,
    });
    const menuItem = await screen.findByTestId("viewer-tab-context-menu-toggle-source");
    expect(menuItem).toHaveTextContent("View source");
    fireEvent.click(menuItem);

    await waitFor(() => expect(screen.getByTestId("viewer-code")).toBeInTheDocument());
    expect(screen.getByTestId("viewer-code")).toHaveTextContent("# Preview");

    fireEvent.contextMenu(screen.getByTestId("viewer-tab-docs/preview.md"), {
      clientX: 100,
      clientY: 80,
    });
    const renderedItem = await screen.findByTestId("viewer-tab-context-menu-toggle-source");
    expect(renderedItem).toHaveTextContent("View rendered");
    fireEvent.click(renderedItem);
    await waitFor(() => expect(screen.getByTestId("viewer-markdown")).toBeInTheDocument());
  });
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
    expect(rows[0]).toHaveAttribute("data-kind", "meta");
    expect(rows[0]).toHaveTextContent("--- src/a.ts");
    expect(rows[1]).toHaveAttribute("data-kind", "meta");
    expect(rows[1]).toHaveTextContent("+++ src/a.ts");
    expect(rows[2]).toHaveAttribute("data-kind", "hunk");
    expect(rows[2]).toHaveTextContent("@@ -1,2 +1,2 @@");
    expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual([
      "meta",
      "meta",
      "hunk",
      "ctx",
      "del",
      "add",
    ]);
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

  it("evicts the cached content when its tab is closed", async () => {
    const serverId = freshServer();
    const requestMock = mountViewer(serverId, { "src/a.ts": textContent("alpha") });
    openTab(serverId, "src/a.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toHaveTextContent("alpha"));
    expect(contentCalls(requestMock, "src/a.ts")).toBe(1);

    fireEvent.click(screen.getByTestId("viewer-tab-close-src/a.ts"));
    await waitFor(() => expect(screen.getByTestId("viewer-empty")).toBeInTheDocument());

    // Re-opening the same file fetches again: the close evicted the entry.
    openTab(serverId, "src/a.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toHaveTextContent("alpha"));
    expect(contentCalls(requestMock, "src/a.ts")).toBe(2);
  });

  it("scopes the cache to the active directory (project switch refetches)", async () => {
    const serverId = freshServer();
    setActiveServer(serverId);
    setCurrent(serverId, "/proj/alpha");
    let dir = "/proj/alpha";
    const requestMock = mountViewer(serverId, () => textContent(`content of ${dir}`));
    openTab(serverId, "src/a.ts");
    await waitFor(() =>
      expect(screen.getByTestId("viewer-code")).toHaveTextContent("content of /proj/alpha"),
    );
    expect(contentCalls(requestMock, "src/a.ts")).toBe(1);

    // Project switch: the shell resets the viewer store and the active
    // directory changes; re-opening the same path must refetch instead of
    // showing the previous directory's payload.
    resetServer(serverId);
    setCurrent(serverId, "/proj/beta");
    dir = "/proj/beta";
    openTab(serverId, "src/a.ts");
    await waitFor(() =>
      expect(screen.getByTestId("viewer-code")).toHaveTextContent("content of /proj/beta"),
    );
    expect(contentCalls(requestMock, "src/a.ts")).toBe(2);
  });
});

describe("FileViewer line targeting (TASK-M4-05)", () => {
  /** Three `.line` spans so data-line tags land on 1..3. */
  const THREE_LINES = `<pre><code><span class="line">const a = 1;</span><span class="line">const b = 2;</span><span class="line">const c = 3;</span></code></pre>`;

  function scrollSpy(): ReturnType<typeof vi.fn> {
    // jsdom lacks scrollIntoView; define it as a spy on Element.prototype
    // (removed in afterEach so later tests keep the optional-call path).
    const spy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: spy,
    });
    return spy;
  }

  it("scrolls to and flashes the pending hit line, then clears it", async () => {
    const serverId = freshServer();
    const scroll = scrollSpy();
    vi.useFakeTimers();
    highlightMock.mockResolvedValue(THREE_LINES);
    mountViewer(serverId, {
      "src/a.ts": textContent("const a = 1;\nconst b = 2;\nconst c = 3;\n"),
    });
    openTab(serverId, "src/a.ts");
    setActiveLine(serverId, "src/a.ts", 2);

    await vi.advanceTimersByTimeAsync(0);
    expect(scroll).toHaveBeenCalledWith({ block: "center" });
    const lineEl = document.querySelector('[data-line="2"]');
    expect(lineEl).not.toBeNull();
    expect(lineEl).toHaveClass("viewer-line-flash");
    // Consumed immediately so re-renders never re-trigger.
    expect(viewer[serverId]?.activeLine).toBeNull();

    // The flash class is removed after the flash window.
    await vi.advanceTimersByTimeAsync(1600);
    expect(lineEl).not.toHaveClass("viewer-line-flash");
  });

  it("tags every highlighted line with its number", async () => {
    const serverId = freshServer();
    vi.useFakeTimers();
    highlightMock.mockResolvedValue(THREE_LINES);
    mountViewer(serverId, {
      "src/a.ts": textContent("const a = 1;\nconst b = 2;\nconst c = 3;\n"),
    });
    openTab(serverId, "src/a.ts");

    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll("[data-line]")).toHaveLength(3);
    expect(document.querySelector('[data-line="3"]')?.textContent).toBe("const c = 3;");
  });

  it("keeps a pending line while hidden and consumes it when shown", async () => {
    const serverId = freshServer();
    const scroll = scrollSpy();
    vi.useFakeTimers();
    highlightMock.mockResolvedValue(THREE_LINES);
    // Mounted with a reactive visible binding (the spread-based mountViewer
    // would freeze the value).
    const requestMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(httpResponse(textContent("const a = 1;\nconst b = 2;\nconst c = 3;\n"))),
      );
    const transport: Transport = { request: requestMock as unknown as Transport["request"] };
    getApiClientMock.mockReturnValue(new ApiClient(transport));
    const [visible, setVisible] = createSignal(false);
    render(() => <FileViewer serverId={serverId} visible={visible()} />);
    openTab(serverId, "src/a.ts");
    setActiveLine(serverId, "src/a.ts", 2);

    await vi.advanceTimersByTimeAsync(0);
    expect(scroll).not.toHaveBeenCalled();
    expect(viewer[serverId]?.activeLine).toEqual({ path: "src/a.ts", line: 2 });

    // Flipping the viewer visible consumes the target.
    setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(scroll).toHaveBeenCalledWith({ block: "center" });
    expect(viewer[serverId]?.activeLine).toBeNull();
  });

  it("clears a pending line that is out of range", async () => {
    const serverId = freshServer();
    const scroll = scrollSpy();
    vi.useFakeTimers();
    highlightMock.mockResolvedValue(THREE_LINES);
    mountViewer(serverId, {
      "src/a.ts": textContent("const a = 1;\nconst b = 2;\nconst c = 3;\n"),
    });
    openTab(serverId, "src/a.ts");
    setActiveLine(serverId, "src/a.ts", 99);

    await vi.advanceTimersByTimeAsync(0);
    expect(scroll).not.toHaveBeenCalled();
    expect(viewer[serverId]?.activeLine).toBeNull();
  });
});

describe("FileViewer mobile zoom (TASK-M7-09)", () => {
  it("offers the zoom chip and double-tap toggle only in fullscreen mode", async () => {
    const serverId = freshServer();
    mountViewer(serverId, { "src/a.ts": textContent("const x = 1;") });
    openTab(serverId, "src/a.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toBeInTheDocument());

    // Desktop (no fullscreen): no chip, no zoom wrapper behavior.
    expect(screen.queryByTestId("viewer-zoom-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("viewer-zoom-wrap")).toHaveAttribute("data-zoom", "100");

    const wrap = screen.getByTestId("viewer-zoom-wrap");
    fireEvent.dblClick(wrap);
    expect(screen.getByTestId("viewer-zoom-wrap")).toHaveAttribute("data-zoom", "100");
  });

  it("toggles to 150% on double-tap and back, scaling the code container", async () => {
    const serverId = freshServer();
    mountViewer(serverId, { "src/a.ts": textContent("const x = 1;") }, { fullscreen: true });
    openTab(serverId, "src/a.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toBeInTheDocument());

    const wrap = screen.getByTestId("viewer-zoom-wrap");
    expect(wrap).toHaveAttribute("data-zoom", "100");
    expect(wrap.style.transform).toBe("");

    fireEvent.dblClick(wrap);
    await waitFor(() => expect(wrap).toHaveAttribute("data-zoom", "150"));
    expect(wrap.style.transform).toBe("scale(1.5)");
    expect(wrap.style.transformOrigin).toBe("top left");
    // The chip mirrors the state.
    expect(screen.getByTestId("viewer-zoom-toggle")).toHaveTextContent("150%");

    // Tapping the chip (or a second double-tap) returns to 100%.
    fireEvent.click(screen.getByTestId("viewer-zoom-toggle"));
    expect(wrap).toHaveAttribute("data-zoom", "100");
    expect(wrap.style.transform).toBe("");
  });

  it("enables pan-able touch scrolling in fullscreen mode", async () => {
    const serverId = freshServer();
    mountViewer(serverId, { "src/a.ts": textContent("const x = 1;") }, { fullscreen: true });
    openTab(serverId, "src/a.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toBeInTheDocument());

    const scroll = screen.getByTestId("viewer-zoom-wrap").parentElement as HTMLElement;
    expect(scroll.style.touchAction).toBe("pan-x pan-y");
  });

  it("resets the zoom when the active file changes", async () => {
    const serverId = freshServer();
    mountViewer(
      serverId,
      { "src/a.ts": textContent("const a = 1;"), "src/b.ts": textContent("const b = 2;") },
      { fullscreen: true },
    );
    openTab(serverId, "src/a.ts");
    // Prime a's cache first: opening b supersedes a's in-flight fetch (the
    // viewer drops the stale result), so a must be fully cached before the
    // switch-back below.
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toBeInTheDocument());
    openTab(serverId, "src/b.ts");
    await waitFor(() =>
      expect(screen.getByTestId("viewer-code")).toHaveTextContent("const b = 2;"),
    );

    const wrap = screen.getByTestId("viewer-zoom-wrap");
    fireEvent.dblClick(wrap);
    await waitFor(() => expect(wrap).toHaveAttribute("data-zoom", "150"));

    // The fullscreen tab bar is non-interactive (it shows only the pushed
    // file), so a file switch arrives through the store, as openTab does.
    openTab(serverId, "src/a.ts");
    await waitFor(() => expect(wrap).toHaveAttribute("data-zoom", "100"));
  });

  it("fullscreen shows only the pushed tab — no switching or closing", async () => {
    const serverId = freshServer();
    mountViewer(
      serverId,
      { "src/a.ts": textContent("alpha"), "src/b.ts": textContent("beta") },
      { fullscreen: true },
    );
    openTab(serverId, "src/a.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toHaveTextContent("alpha"));
    openTab(serverId, "src/b.ts");
    await waitFor(() => expect(screen.getByTestId("viewer-code")).toHaveTextContent("beta"));

    // Only the pushed (active) tab renders — the other tab is not
    // reachable, so the content can never drift from the page title.
    expect(screen.getByTestId("viewer-tab-src/b.ts")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("viewer-tab-src/a.ts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("viewer-tab-close-src/b.ts")).not.toBeInTheDocument();
    // The zoom chip still mirrors the state.
    expect(screen.getByTestId("viewer-zoom-toggle")).toBeInTheDocument();
  });
});
