// L2 tests for the file tree panel (TASK-M4-02): renders the nested tree
// from the files store (dirs first, status dots, ignored styling), lazy
// directory expansion via GET /file?path= grafting, collapse, the right-click
// menu (copy path / reference-to-clipboard / open), watcher-event refetch
// (store version bump -> tree + status re-fetched), and the loading / empty /
// error states.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { ApiClient, type Transport } from "../../services/client";
import type { FileNode } from "../../services/file";
import { applyWatcher, resetServer } from "../../stores/files";
import FileTree, { type FileTreeProps } from "./FileTree";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/client.js")>();
  return { ...actual, getApiClient: getApiClientMock };
});

const SERVER = "srv-filetree";

function node(path: string, type: FileNode["type"], ignored = false): FileNode {
  const segments = path.split("/");
  return {
    name: segments[segments.length - 1],
    path,
    absolute: `/mock/projects/demo/${path}`,
    type,
    ignored,
  };
}

/** The workspace root payload used by default (flat FileNode list). */
const ROOT_NODES: FileNode[] = [
  node("src", "directory"),
  node("src/auth", "directory"),
  node("src/auth/login.ts", "file"),
  node("node_modules", "directory", true),
  node("README.md", "file"),
];

/** Subtree payload for the `src` expansion (echoes its root node). */
const SRC_NODES: FileNode[] = [
  node("src/App.tsx", "file"),
  node("src/auth", "directory"),
  node("src/auth/session.ts", "file"),
];

/** Subtree payload for the `src/auth` expansion (no root echo). */
const AUTH_NODES: FileNode[] = [
  node("src/auth/login.ts", "file"),
  node("src/auth/session.ts", "file"),
];

/** Default per-path routing: root / `src` / `src/auth` subtrees. */
function treeForPath(path: string | undefined): unknown {
  if (path === "src") return SRC_NODES;
  if (path === "src/auth") return AUTH_NODES;
  return ROOT_NODES;
}

function httpResponse(body: unknown) {
  return { status: 200, headers: {}, body, bodyText: undefined };
}

let requestMock: ReturnType<typeof vi.fn>;
let writeTextMock: ReturnType<typeof vi.fn>;

/** Injects a client whose transport records every call; `treeForPath`
 *  decides the GET /file payload (root or subtree). */
function mountTree(
  props: Partial<FileTreeProps> = {},
  treeForPath: (path: string | undefined) => unknown = () => ROOT_NODES,
  statuses: unknown = [],
): void {
  requestMock = vi
    .fn()
    .mockImplementation((input: { path: string; query?: Record<string, string> }) => {
      const path = input.query?.path;
      if (input.path === "/file/status") return Promise.resolve(httpResponse(statuses));
      if (input.path === "/file") return Promise.resolve(httpResponse(treeForPath(path)));
      return Promise.resolve(httpResponse(undefined));
    });
  const transport: Transport = {
    request: requestMock as unknown as Transport["request"],
  };
  getApiClientMock.mockReturnValue(new ApiClient(transport));
  render(() => <FileTree serverId={SERVER} {...props} />);
}

beforeEach(() => {
  resetServer(SERVER);
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue(new ApiClient({ request: vi.fn() }));
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: writeTextMock },
  });
});

afterEach(() => {
  resetServer(SERVER);
  delete (navigator as { clipboard?: unknown }).clipboard;
});

function row(path: string): HTMLElement {
  return screen.getByTestId(`file-row-${path}`);
}

describe("FileTree rendering", () => {
  it("renders the nested tree with dirs first and status dots", async () => {
    mountTree({}, treeForPath, [
      { path: "README.md", added: 5, removed: 0, status: "added" },
      { path: "src/auth/login.ts", added: 12, removed: 4, status: "modified" },
      { path: "src/auth/session.ts", added: 0, removed: 3, status: "deleted" },
    ]);

    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());
    expect(screen.getByTestId("file-row-node_modules")).toBeInTheDocument();
    expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument();
    // Unloaded dirs render no children yet (lazy expansion).
    expect(screen.queryByTestId("file-row-src/auth/login.ts")).not.toBeInTheDocument();

    let dots = screen.getAllByTestId("file-status-dot");
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute("data-status", "added");
    expect(dots[0]).toHaveClass("bg-success");

    // Nested file dots appear once their directories expand.
    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("file-row-src/auth")).toBeInTheDocument());
    fireEvent.click(row("src/auth"));
    await waitFor(() =>
      expect(screen.getByTestId("file-row-src/auth/session.ts")).toBeInTheDocument(),
    );

    dots = screen.getAllByTestId("file-status-dot");
    expect(dots.map((el) => el.getAttribute("data-status")).sort()).toEqual([
      "added",
      "deleted",
      "modified",
    ]);
    expect(
      screen.getByTestId("file-row-README.md").querySelector('[data-status="added"]'),
    ).toHaveClass("bg-success");
    expect(
      screen.getByTestId("file-row-src/auth/login.ts").querySelector('[data-status="modified"]'),
    ).toHaveClass("bg-warning");
    expect(
      screen.getByTestId("file-row-src/auth/session.ts").querySelector('[data-status="deleted"]'),
    ).toHaveClass("bg-danger");
  });

  it("grayes ignored entries and keeps clean files dotless", async () => {
    mountTree({}, undefined, []);
    await waitFor(() => expect(screen.getByTestId("file-row-node_modules")).toBeInTheDocument());

    expect(row("node_modules")).toHaveAttribute("data-ignored", "true");
    expect(screen.getByText("node_modules").closest("span")).toHaveClass("italic");
    expect(row("README.md")).toHaveAttribute("data-ignored", "false");
    expect(screen.queryAllByTestId("file-status-dot")).toHaveLength(0);
  });

  it("calls onOpenFile when a file row is clicked", async () => {
    const onOpenFile = vi.fn();
    mountTree({ onOpenFile });
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());

    fireEvent.click(row("README.md"));
    expect(onOpenFile).toHaveBeenCalledWith("README.md");
  });
});

describe("lazy expansion", () => {
  it("expands a dir by fetching its subtree and grafting the children", async () => {
    mountTree({}, treeForPath, []);
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("file-row-src/App.tsx")).toBeInTheDocument());
    expect(screen.getByTestId("file-row-src/auth")).toBeInTheDocument();
    // Nested dirs stay unloaded until their own expansion fetch.
    expect(screen.queryByTestId("file-row-src/auth/session.ts")).not.toBeInTheDocument();
    expect(within(row("src")).getByTestId("file-chevron")).toHaveAttribute("data-expanded", "true");

    // The expansion fetch carried the directory path.
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/file", query: { path: "src" } }),
    );
  });

  it("expands a nested dir through its own fetch without refetching on toggle", async () => {
    mountTree({}, treeForPath, []);
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("file-row-src/auth")).toBeInTheDocument());
    fireEvent.click(row("src/auth"));
    await waitFor(() =>
      expect(screen.getByTestId("file-row-src/auth/session.ts")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("file-row-src/auth/login.ts")).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/file", query: { path: "src/auth" } }),
    );

    const callsBefore = requestMock.mock.calls.length;
    fireEvent.click(row("src/auth"));
    expect(screen.queryByTestId("file-row-src/auth/session.ts")).not.toBeInTheDocument();
    fireEvent.click(row("src/auth"));
    await waitFor(() =>
      expect(screen.getByTestId("file-row-src/auth/session.ts")).toBeInTheDocument(),
    );
    expect(requestMock.mock.calls.length).toBe(callsBefore);
  });

  it("collapses an expanded dir and hides its children", async () => {
    mountTree({}, treeForPath, []);
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("file-row-src/App.tsx")).toBeInTheDocument());

    fireEvent.click(row("src"));
    expect(screen.queryByTestId("file-row-src/App.tsx")).not.toBeInTheDocument();
    // Children stay loaded: re-expanding does not refetch.
    const callsBefore = requestMock.mock.calls.length;
    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("file-row-src/App.tsx")).toBeInTheDocument());
    expect(requestMock.mock.calls.length).toBe(callsBefore);
  });

  it("keeps an earlier sibling expansion's children when a later one resolves first", async () => {
    // Deferred expansion payloads so the test can order resolutions by hand.
    const pending = new Map<string, (value: unknown) => void>();
    const deferred = (path: string | undefined) =>
      new Promise((resolve) => {
        pending.set(path ?? "", resolve);
      });
    requestMock = vi
      .fn()
      .mockImplementation((input: { path: string; query?: Record<string, string> }) => {
        if (input.path === "/file/status") return Promise.resolve(httpResponse([]));
        const path = input.query?.path;
        if (path === "src" || path === "node_modules") return deferred(path);
        return Promise.resolve(httpResponse(ROOT_NODES));
      });
    const transport: Transport = {
      request: requestMock as unknown as Transport["request"],
    };
    getApiClientMock.mockReturnValue(new ApiClient(transport));
    render(() => <FileTree serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    fireEvent.click(row("src"));
    fireEvent.click(row("node_modules"));
    expect(pending.size).toBe(2);

    // Dir B resolves first, then dir A.
    pending.get("node_modules")!(httpResponse([node("node_modules/pkg", "directory")]));
    await waitFor(() =>
      expect(screen.getByTestId("file-row-node_modules/pkg")).toBeInTheDocument(),
    );
    pending.get("src")!(httpResponse(SRC_NODES));
    await waitFor(() => expect(screen.getByTestId("file-row-src/App.tsx")).toBeInTheDocument());

    // A's graft must survive B's resolution: children present AND expanded.
    expect(screen.getByTestId("file-row-src/App.tsx")).toBeInTheDocument();
    expect(screen.getByTestId("file-row-node_modules/pkg")).toBeInTheDocument();
    expect(within(row("src")).getByTestId("file-chevron")).toHaveAttribute("data-expanded", "true");
  });

  it("reverts the expansion and shows the error banner when the fetch fails", async () => {
    mountTree(
      {},
      (path) => {
        if (path === "src") throw new Error("boom");
        return ROOT_NODES;
      },
      [],
    );
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.queryByTestId("file-row-src/App.tsx")).not.toBeInTheDocument();
  });
});

describe("context menu", () => {
  async function openContextMenu(path: string) {
    fireEvent.contextMenu(row(path), { clientX: 30, clientY: 40 });
    await waitFor(() => expect(screen.getByTestId("file-context-menu")).toBeInTheDocument());
  }

  it("copy path writes the path to the clipboard", async () => {
    mountTree({}, undefined, []);
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());

    await openContextMenu("README.md");
    fireEvent.click(screen.getByTestId("file-context-copy"));
    await waitFor(() =>
      expect(screen.getByTestId("file-context-copy")).toHaveTextContent("✓ Copied"),
    );
    expect(writeTextMock).toHaveBeenCalledWith("README.md");
  });

  it("reference in chat copies the @path token when no hook is wired", async () => {
    mountTree({}, undefined, []);
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());

    await openContextMenu("README.md");
    fireEvent.click(screen.getByTestId("file-context-reference"));
    await waitFor(() =>
      expect(screen.getByTestId("file-context-reference")).toHaveTextContent("✓ Copied @path"),
    );
    expect(writeTextMock).toHaveBeenCalledWith("@README.md");
  });

  it("reference in chat calls the onReference hook when provided", async () => {
    const onReference = vi.fn();
    mountTree({ onReference });
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());

    await openContextMenu("README.md");
    fireEvent.click(screen.getByTestId("file-context-reference"));
    expect(onReference).toHaveBeenCalledWith("README.md");
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("open is disabled for dirs and calls onOpenFile for files", async () => {
    const onOpenFile = vi.fn();
    mountTree({ onOpenFile });
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    await openContextMenu("src");
    expect(screen.getByTestId("file-context-open")).toBeDisabled();
    fireEvent.click(screen.getByTestId("file-context-backdrop"));

    await openContextMenu("README.md");
    fireEvent.click(screen.getByTestId("file-context-open"));
    expect(onOpenFile).toHaveBeenCalledWith("README.md");
  });
});

describe("watcher refetch and states", () => {
  it("refetches tree and statuses when a watcher event bumps the version", async () => {
    mountTree({}, undefined, []);
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());
    const callsAfterMount = requestMock.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    applyWatcher(SERVER, "README.md");
    await waitFor(() => expect(requestMock.mock.calls.length).toBeGreaterThan(callsAfterMount));
    const fileCalls = requestMock.mock.calls.filter(
      (call) => (call[0] as { path: string }).path === "/file",
    );
    expect(fileCalls.length).toBe(2);
    const statusCalls = requestMock.mock.calls.filter(
      (call) => (call[0] as { path: string }).path === "/file/status",
    );
    expect(statusCalls.length).toBe(2);
  });

  it("renders the loading state while the first fetch is in flight", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const transport: Transport = {
      request: vi.fn().mockImplementation(() => new Promise((resolve) => resolvers.push(resolve))),
    };
    getApiClientMock.mockReturnValue(new ApiClient(transport));
    render(() => <FileTree serverId={SERVER} />);

    expect(screen.getByTestId("file-tree-loading")).toBeInTheDocument();
    // Resolve every in-flight call (root fetch + status run in parallel).
    for (const resolve of resolvers) resolve(httpResponse(ROOT_NODES));
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());
    expect(screen.queryByTestId("file-tree-loading")).not.toBeInTheDocument();
  });

  it("renders the empty state for an empty workspace", async () => {
    mountTree({}, () => [], []);
    await waitFor(() => expect(screen.getByTestId("file-tree-empty")).toBeInTheDocument());
  });

  it("renders the error banner and retries the load", async () => {
    mountTree(
      {},
      () => {
        throw new Error("boom");
      },
      [],
    );
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());

    requestMock.mockImplementation(() => Promise.resolve(httpResponse(ROOT_NODES)));
    fireEvent.click(screen.getByTestId("file-tree-retry"));
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });

  it("keeps the loaded tree visible during a watcher refetch", async () => {
    mountTree({}, undefined, []);
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());

    applyWatcher(SERVER, "README.md");
    await waitFor(() => expect(requestMock.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument();
  });

  it("refetches expanded dir subtrees after a watcher refetch replaces the root", async () => {
    mountTree({}, treeForPath, []);
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());
    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("file-row-src/auth")).toBeInTheDocument());
    fireEvent.click(row("src/auth"));
    await waitFor(() =>
      expect(screen.getByTestId("file-row-src/auth/session.ts")).toBeInTheDocument(),
    );
    const srcCallsBefore = requestMock.mock.calls.filter(
      (call) => (call[0] as { query?: Record<string, string> }).query?.path === "src",
    ).length;

    applyWatcher(SERVER, "README.md");

    // The root replace drops grafted subtrees; the refill re-fetches the
    // expanded `src`, then its nested expanded `src/auth` as each level lands.
    await waitFor(() => {
      const srcCalls = requestMock.mock.calls.filter(
        (call) => (call[0] as { query?: Record<string, string> }).query?.path === "src",
      );
      expect(srcCalls.length).toBe(srcCallsBefore + 1);
    });
    await waitFor(() =>
      expect(screen.getByTestId("file-row-src/auth/session.ts")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("file-row-src/App.tsx")).toBeInTheDocument();
    expect(within(row("src")).getByTestId("file-chevron")).toHaveAttribute("data-expanded", "true");
    expect(within(row("src/auth")).getByTestId("file-chevron")).toHaveAttribute(
      "data-expanded",
      "true",
    );
  });
});
