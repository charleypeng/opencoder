// L2 tests for the mobile Files flow (TASK-M7-09): the Files tab renders
// the mobile file tree (breadcrumb bar, full-row touch rows); tapping a
// directory descends into it; tapping a file opens the tab in the viewer
// store and pushes the FileView page (reusing the shared viewer store, so
// the pushed page shows the opened file); Back pops back to the tree with
// its navigation state intact.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import MobileShell from "./MobileShell";
import { refreshPlatform } from "../../platform";
import { resetNav } from "./navigation";
import { resetServer as resetFiles } from "../../stores/files";
import { resetServer as resetViewer } from "../../stores/viewer";
import { resetServer as resetSessions } from "../../stores/session";
import { resetServer as resetMessages } from "../../stores/messages";
import { resetServer as resetPermissionStore } from "../../stores/permission";
import { resetServer as resetQuestionStore } from "../../stores/question";
import { resetServer as resetProjects } from "../../stores/project";
import { setActiveServer } from "../../stores/registry";
import type { ServerEntry } from "../../services/servers";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../../services/haptics.js", () => ({ haptic: vi.fn() }));
// FileViewer highlights through Shiki; the stub keeps the flow tests free
// of language-pack loading (the viewer tests cover the real contract).
vi.mock("../../features/messages/markdown/highlighter.js", () => ({
  getHighlighter: vi.fn(),
  highlightCode: vi.fn(async (code: string) => `<pre data-testid="hl">${code}</pre>`),
}));

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const ORIGINAL_UA = window.navigator.userAgent;

const SERVER: ServerEntry = {
  id: "srv-files-mobile",
  name: "Alpha",
  url: "http://localhost:14096",
  createdAt: 1_700_000_000_000,
};

function node(path: string, type: "directory" | "file") {
  const segments = path.split("/");
  return {
    name: segments[segments.length - 1],
    path,
    absolute: `/mock/projects/demo/${path}`,
    type,
  };
}

function httpResponse(body: unknown) {
  return { status: 200, headers: {}, body, bodyText: undefined };
}

function stubAndroid(): void {
  Object.defineProperty(window.navigator, "userAgent", { value: ANDROID_UA, configurable: true });
  delete window.webkit;
  refreshPlatform();
}

const treeForPath = (path: string | undefined): unknown => {
  if (path === "src") {
    return [node("src/App.tsx", "file"), node("src/auth", "directory")];
  }
  return [node("src", "directory"), node("README.md", "file")];
};

beforeEach(() => {
  stubAndroid();
  invokeMock.mockImplementation(
    (cmd: string, args: { request?: { path?: string; query?: Record<string, string> } }) => {
      if (cmd !== "http_request") return Promise.resolve(undefined);
      const request = args?.request ?? {};
      if (request.path === "/file/status") return Promise.resolve(httpResponse([]));
      if (request.path === "/file")
        return Promise.resolve(httpResponse(treeForPath(request.query?.path)));
      if (request.path === "/file/content") {
        return Promise.resolve(
          httpResponse({
            type: "text",
            content: `content of ${request.query?.path}`,
            mimeType: "text/plain",
          }),
        );
      }
      return Promise.resolve(httpResponse([]));
    },
  );
});

afterEach(() => {
  Object.defineProperty(window.navigator, "userAgent", { value: ORIGINAL_UA, configurable: true });
  delete window.webkit;
  refreshPlatform();
  resetNav();
  resetFiles(SERVER.id);
  resetViewer(SERVER.id);
  resetSessions(SERVER.id);
  resetMessages(SERVER.id);
  resetPermissionStore(SERVER.id);
  resetQuestionStore(SERVER.id);
  resetProjects(SERVER.id);
  setActiveServer(null);
  vi.clearAllMocks();
});

function renderShell() {
  return render(() => <MobileShell server={SERVER} onExit={vi.fn()} />);
}

async function openFilesTab(): Promise<HTMLElement> {
  renderShell();
  fireEvent.click(screen.getByTestId("mobile-tab-files"));
  await waitFor(() =>
    expect(screen.getByTestId("mobile-page-files")).toHaveAttribute("data-active", "true"),
  );
  await waitFor(() => screen.getByTestId("file-row-src"));
  return screen.getByTestId("mobile-page-files");
}

describe("mobile Files flow (TASK-M7-09)", () => {
  it("renders the mobile tree with the breadcrumb and touch rows", async () => {
    const filesTab = await openFilesTab();

    const tree = within(filesTab).getByTestId("file-tree");
    expect(tree).toHaveAttribute("data-mobile", "true");
    expect(within(filesTab).getByTestId("file-breadcrumb-root")).toHaveTextContent("Workspace");
    expect(within(filesTab).getByTestId("file-row-src")).toHaveClass("min-h-11");
    expect(within(filesTab).getByTestId("file-row-README.md")).toBeInTheDocument();
  });

  it("descends into a directory and jumps back via the breadcrumb", async () => {
    const filesTab = await openFilesTab();

    fireEvent.click(within(filesTab).getByTestId("file-row-src"));
    await waitFor(() =>
      expect(within(filesTab).getByTestId("file-row-src/App.tsx")).toBeInTheDocument(),
    );
    expect(within(filesTab).getByTestId("file-breadcrumb-src")).toHaveAttribute(
      "data-current",
      "true",
    );

    fireEvent.click(within(filesTab).getByTestId("file-breadcrumb-root"));
    await waitFor(() =>
      expect(within(filesTab).getByTestId("file-row-README.md")).toBeInTheDocument(),
    );
  });

  it("tapping a file pushes the viewer page with the file open", async () => {
    const filesTab = await openFilesTab();

    fireEvent.click(within(filesTab).getByTestId("file-row-README.md"));
    await waitFor(() =>
      expect(within(filesTab).getByTestId("mobile-page-file-view")).toBeInTheDocument(),
    );
    // The pushed page carries the shared viewer (active tab = the opened
    // file) and the mobile fullscreen affordances (zoom chip).
    const view = within(filesTab).getByTestId("mobile-page-file-view");
    expect(within(view).getByTestId("mobile-page-title")).toHaveTextContent("README.md");
    await waitFor(() =>
      expect(within(view).getByTestId("viewer-code")).toHaveTextContent("content of README.md"),
    );
    expect(within(view).getByTestId("viewer-zoom-toggle")).toBeInTheDocument();
    expect(within(view).getByTestId("viewer-zoom-wrap")).toHaveAttribute("data-zoom", "100");
  });

  it("the fullscreen viewer can never switch away from the pushed file", async () => {
    const filesTab = await openFilesTab();

    // Open README.md, back out, then open src/App.tsx (both stay open in
    // the shared viewer store).
    fireEvent.click(within(filesTab).getByTestId("file-row-README.md"));
    await waitFor(() =>
      expect(within(filesTab).getByTestId("mobile-page-file-view")).toBeInTheDocument(),
    );
    fireEvent.click(within(filesTab).getByTestId("page-back"));
    await waitFor(() =>
      expect(within(filesTab).queryByTestId("mobile-page-file-view")).not.toBeInTheDocument(),
    );
    fireEvent.click(within(filesTab).getByTestId("file-row-src"));
    await waitFor(() =>
      expect(within(filesTab).getByTestId("file-row-src/App.tsx")).toBeInTheDocument(),
    );
    fireEvent.click(within(filesTab).getByTestId("file-row-src/App.tsx"));
    await waitFor(() =>
      expect(within(filesTab).getByTestId("mobile-page-file-view")).toBeInTheDocument(),
    );

    const view = within(filesTab).getByTestId("mobile-page-file-view");
    expect(within(view).getByTestId("mobile-page-title")).toHaveTextContent("App.tsx");
    await waitFor(() =>
      expect(within(view).getByTestId("viewer-code")).toHaveTextContent("content of src/App.tsx"),
    );
    // The fullscreen bar shows only the pushed file's tab: the first file
    // is not switchable, so content and title cannot diverge.
    expect(within(view).queryByTestId("viewer-tab-README.md")).not.toBeInTheDocument();
    expect(within(view).getByTestId("viewer-tab-src/App.tsx")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("Back from the viewer returns to the tree with state intact", async () => {
    const filesTab = await openFilesTab();

    fireEvent.click(within(filesTab).getByTestId("file-row-README.md"));
    await waitFor(() =>
      expect(within(filesTab).getByTestId("mobile-page-file-view")).toBeInTheDocument(),
    );

    fireEvent.click(within(filesTab).getByTestId("page-back"));
    await waitFor(() =>
      expect(within(filesTab).queryByTestId("mobile-page-file-view")).not.toBeInTheDocument(),
    );
    // The tree is still there with its rows.
    expect(within(filesTab).getByTestId("file-row-src")).toBeInTheDocument();
  });
});
