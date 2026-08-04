// L2 tests for the mobile file tree variant (TASK-M7-09): the single-level
// browser — the breadcrumb back bar (root + path segments, ancestors jump
// back), tapping a directory descends into it (fetching + grafting the
// subtree through the shared store), re-descending into a loaded dir never
// refetches, the breadcrumb jumps to an ancestor without a fetch, file rows
// open through onOpenFile, rows are full-height touch targets, the
// right-click context menu is never attached, and the dir loading / empty
// folder states render.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { ApiClient, type Transport } from "../../services/client";
import type { FileNode } from "../../services/file";
import { resetServer } from "../../stores/files";
import FileTree from "./FileTree";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/client.js")>();
  return { ...actual, getApiClient: getApiClientMock };
});

const SERVER = "srv-filetree-mobile";

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

const ROOT_NODES: FileNode[] = [
  node("src", "directory"),
  node("src/auth", "directory"),
  node("src/auth/login.ts", "file"),
  node("README.md", "file"),
];

const SRC_NODES: FileNode[] = [
  node("src/App.tsx", "file"),
  node("src/auth", "directory"),
  node("src/auth/session.ts", "file"),
];

const AUTH_NODES: FileNode[] = [
  node("src/auth/login.ts", "file"),
  node("src/auth/session.ts", "file"),
];

function treeForPath(path: string | undefined): unknown {
  if (path === "src") return SRC_NODES;
  if (path === "src/auth") return AUTH_NODES;
  return ROOT_NODES;
}

function httpResponse(body: unknown) {
  return { status: 200, headers: {}, body, bodyText: undefined };
}

let requestMock: ReturnType<typeof vi.fn>;

function mountTree(
  props: { onOpenFile?: (path: string) => void } = {},
  treeForPath: (path: string | undefined) => unknown = () => ROOT_NODES,
): void {
  requestMock = vi
    .fn()
    .mockImplementation((input: { path: string; query?: Record<string, string> }) => {
      const path = input.query?.path;
      if (input.path === "/file/status") return Promise.resolve(httpResponse([]));
      if (input.path === "/file") return Promise.resolve(httpResponse(treeForPath(path)));
      return Promise.resolve(httpResponse(undefined));
    });
  const transport: Transport = {
    request: requestMock as unknown as Transport["request"],
  };
  getApiClientMock.mockReturnValue(new ApiClient(transport));
  render(() => <FileTree serverId={SERVER} variant="mobile" {...props} />);
}

beforeEach(() => {
  resetServer(SERVER);
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue(new ApiClient({ request: vi.fn() }));
});

afterEach(() => {
  resetServer(SERVER);
});

function row(path: string): HTMLElement {
  return screen.getByTestId(`file-row-${path}`);
}

describe("FileTree mobile variant", () => {
  it("renders the root with the breadcrumb bar and full-row touch rows", async () => {
    mountTree({}, treeForPath);
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    expect(screen.getByTestId("file-tree")).toHaveAttribute("data-mobile", "true");
    expect(screen.getByTestId("file-breadcrumb-bar")).toBeInTheDocument();
    // Root crumb only: [Workspace ›]
    expect(screen.getByTestId("file-breadcrumb-root")).toHaveTextContent("Workspace");
    expect(screen.getByTestId("file-breadcrumb-root")).toHaveAttribute("data-current", "true");

    // Full-row touch targets (min 44px).
    expect(row("src")).toHaveClass("min-h-11");
    expect(row("README.md")).toHaveClass("min-h-11");
    // No chevrons in the single-level mobile list.
    expect(screen.queryByTestId("file-chevron")).not.toBeInTheDocument();
  });

  it("descends into a directory, fetching and grafting its subtree", async () => {
    mountTree({}, treeForPath);
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("file-row-src/App.tsx")).toBeInTheDocument());

    // The mobile list shows only the current dir's children.
    expect(screen.getByTestId("file-row-src/auth")).toBeInTheDocument();
    expect(screen.queryByTestId("file-row-src/auth/login.ts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-row-README.md")).not.toBeInTheDocument();

    // Breadcrumb trail: Workspace › src (src is the current, non-interactive).
    expect(screen.getByTestId("file-breadcrumb-root")).toHaveTextContent("Workspace ›");
    expect(screen.getByTestId("file-breadcrumb-src")).toHaveTextContent("src");
    expect(screen.getByTestId("file-breadcrumb-src")).toHaveAttribute("data-current", "true");
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/file", query: { path: "src" } }),
    );
  });

  it("descends through nested dirs and re-descends a loaded dir without refetching", async () => {
    mountTree({}, treeForPath);
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("file-row-src/auth")).toBeInTheDocument());
    fireEvent.click(row("src/auth"));
    await waitFor(() =>
      expect(screen.getByTestId("file-row-src/auth/session.ts")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("file-row-src/auth/login.ts")).toBeInTheDocument();
    expect(screen.getByTestId("file-breadcrumb-src/auth")).toHaveAttribute("data-current", "true");

    // Back to src via the breadcrumb, then re-descend: no new fetch.
    const callsBefore = requestMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("file-breadcrumb-src"));
    await waitFor(() => expect(screen.getByTestId("file-row-src/App.tsx")).toBeInTheDocument());
    expect(screen.queryByTestId("file-row-src/auth/session.ts")).not.toBeInTheDocument();

    fireEvent.click(row("src/auth"));
    await waitFor(() =>
      expect(screen.getByTestId("file-row-src/auth/session.ts")).toBeInTheDocument(),
    );
    expect(requestMock.mock.calls.length).toBe(callsBefore);
  });

  it("jumps straight to the workspace root from a deep directory", async () => {
    mountTree({}, treeForPath);
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());
    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("file-row-src/auth")).toBeInTheDocument());
    fireEvent.click(row("src/auth"));
    await waitFor(() =>
      expect(screen.getByTestId("file-row-src/auth/session.ts")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("file-breadcrumb-root"));
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());
    expect(screen.queryByTestId("file-row-src/auth")).not.toBeInTheDocument();
  });

  it("opens a file through onOpenFile", async () => {
    const onOpenFile = vi.fn();
    mountTree({ onOpenFile }, treeForPath);
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());

    fireEvent.click(row("README.md"));
    expect(onOpenFile).toHaveBeenCalledWith("README.md");
  });

  it("never attaches the right-click context menu", async () => {
    mountTree({}, treeForPath);
    await waitFor(() => expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument());

    fireEvent.contextMenu(row("README.md"), { clientX: 30, clientY: 40 });
    expect(screen.queryByTestId("file-context")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-context-backdrop")).not.toBeInTheDocument();
  });

  it("shows the dir loading row while a subtree fetch is in flight", async () => {
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
        if (path === "src") return deferred(path);
        return Promise.resolve(httpResponse(ROOT_NODES));
      });
    const transport: Transport = {
      request: requestMock as unknown as Transport["request"],
    };
    getApiClientMock.mockReturnValue(new ApiClient(transport));
    render(() => <FileTree serverId={SERVER} variant="mobile" />);
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    fireEvent.click(row("src"));
    expect(screen.getByTestId("file-tree-dir-loading")).toBeInTheDocument();

    pending.get("src")!(httpResponse(SRC_NODES));
    await waitFor(() => expect(screen.getByTestId("file-row-src/App.tsx")).toBeInTheDocument());
    expect(screen.queryByTestId("file-tree-dir-loading")).not.toBeInTheDocument();
  });

  it("falls back to the workspace root when descending into a directory fails", async () => {
    requestMock = vi
      .fn()
      .mockImplementation((input: { path: string; query?: Record<string, string> }) => {
        if (input.path === "/file/status") return Promise.resolve(httpResponse([]));
        const path = input.query?.path;
        if (path === "src") return Promise.reject(new Error("boom"));
        return Promise.resolve(httpResponse(ROOT_NODES));
      });
    const transport: Transport = {
      request: requestMock as unknown as Transport["request"],
    };
    getApiClientMock.mockReturnValue(new ApiClient(transport));
    render(() => <FileTree serverId={SERVER} variant="mobile" />);
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());

    // Not stranded on the failed dir: the view is back at the workspace
    // root (its rows visible) with the error banner + retry on top.
    expect(screen.getByTestId("file-breadcrumb-root")).toHaveAttribute("data-current", "true");
    expect(screen.getByTestId("file-row-README.md")).toBeInTheDocument();
    expect(screen.queryByTestId("file-row-src/App.tsx")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-tree-empty")).not.toBeInTheDocument();
  });

  it("renders the empty folder state for an empty subdirectory", async () => {
    mountTree({}, (path) => {
      if (path === "src") return [node("src", "directory")];
      return ROOT_NODES;
    });
    await waitFor(() => expect(screen.getByTestId("file-row-src")).toBeInTheDocument());

    fireEvent.click(row("src"));
    await waitFor(() => expect(screen.getByTestId("file-tree-empty")).toBeInTheDocument());
    expect(screen.getByTestId("file-tree-empty")).toHaveTextContent("Empty folder");
    expect(screen.getByTestId("file-tree-empty")).toHaveTextContent("Nothing in this folder.");
  });

  it("renders the workspace empty state at the root", async () => {
    mountTree({}, () => []);
    await waitFor(() => expect(screen.getByTestId("file-tree-empty")).toBeInTheDocument());
    expect(screen.getByTestId("file-tree-empty")).toHaveTextContent("No files");
  });
});
