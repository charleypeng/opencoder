// FilePickerDialog tests (TASK-UI-01 filepicker): the project-directory
// picker behind the sessions "+" button — live server directory listings
// (GET /file?path=), case-insensitive segment filtering, browse-into-folder
// clicks, keyboard navigation, raw-path creation, and error surfaces.

import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FilePickerDialog from "./FilePickerDialog";
import type { FileNode } from "../../services/file";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client", () => ({ getApiClient: getApiClientMock }));

type MockClient = {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const ROOT = "/mock/projects/opencode-demo";

/** A FileNode whose name/path are derived like the real server's. */
function entry(path: string, type: FileNode["type"]): FileNode {
  const name = path.split("/").pop() ?? path;
  return {
    name,
    path: `${path}${type === "directory" ? "/" : ""}`,
    absolute: `${ROOT}/${path}`,
    type,
    ignored: false,
  };
}

/** Per-directory listings; absolute workspace paths resolve like the real
 *  server (root-relative form). */
function listingsFor(path: string | undefined): FileNode[] {
  const rel = (path ?? "").startsWith(ROOT) ? (path ?? "").slice(ROOT.length + 1) : (path ?? "");
  switch (rel) {
    case "src":
      return [entry("src/features", "directory"), entry("src/App.tsx", "file")];
    case "src/features":
      return [entry("src/features/sessions", "directory"), entry("src/features/chat.ts", "file")];
    default:
      return [
        entry("src", "directory"),
        entry("node_modules", "directory"),
        entry("README.md", "file"),
      ];
  }
}

function mockClient(): MockClient {
  const client = {
    get: vi.fn(async (_url: string, opts?: { query?: { path?: string } }) =>
      listingsFor(opts?.query?.path),
    ),
    post: vi.fn(async () => ({
      id: "sess_1",
      directory: ROOT,
      title: "",
      time: { created: 1, updated: 1 },
    })),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

function renderPicker(overrides: Partial<Parameters<typeof FilePickerDialog>[0]> = {}) {
  const props = {
    serverId: "srv_1",
    onClose: vi.fn(),
    onCreated: vi.fn(),
    ...overrides,
  };
  render(() => <FilePickerDialog {...props} />);
  return props;
}

describe("FilePickerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the workspace root listing into suggestions on mount", async () => {
    const client = mockClient();
    renderPicker();

    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());
    expect(screen.getByTestId("filepicker-suggestion-0")).toHaveTextContent("src");
    expect(screen.getByTestId("filepicker-suggestion-1")).toHaveTextContent("node_modules");
    // The root listing carries the required empty path (real server 400s
    // without it).
    expect(client.get).toHaveBeenCalledWith("/file", { query: { path: "" } });
  });

  it("shows folders and files, with files non-selectable", async () => {
    mockClient();
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-2")).toBeInTheDocument());

    const file = screen.getByTestId("filepicker-suggestion-2");
    expect(file).toHaveAttribute("data-type", "file");
    expect(file).toHaveAttribute("aria-disabled", "true");
    expect(file).toBeDisabled();
    expect(screen.getByTestId("filepicker-suggestion-0")).toHaveAttribute("data-type", "directory");
  });

  it("lists the typed folder and filters by the last segment (case-insensitive)", async () => {
    const client = mockClient();
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    fireEvent.input(screen.getByTestId("filepicker-input"), {
      target: { value: "src/FE" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("filepicker-suggestion-0")).toHaveTextContent("features"),
    );
    // The parent directory was fetched from the server.
    expect(client.get).toHaveBeenCalledWith("/file", { query: { path: "src" } });
    expect(screen.queryByText("App.tsx")).toBeNull();
  });

  it("browses into a folder on click and lists its children", async () => {
    const client = mockClient();
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("filepicker-suggestion-0"));
    await waitFor(() => expect(screen.getByTestId("filepicker-input")).toHaveValue(`${ROOT}/src/`));
    await waitFor(() =>
      expect(client.get).toHaveBeenCalledWith("/file", { query: { path: `${ROOT}/src` } }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("filepicker-suggestion-0")).toHaveTextContent("features"),
    );
    expect(screen.getByTestId("filepicker-suggestion-1")).toHaveTextContent("App.tsx");
  });

  it("creates in the highlighted folder on Enter", async () => {
    const client = mockClient();
    const props = renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByTestId("filepicker-input"), { key: "Enter" });
    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", {
        body: { title: undefined },
        query: { directory: `${ROOT}/src` },
      }),
    );
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledTimes(1));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("creates in the stripped path when the input names an explicit directory", async () => {
    const client = mockClient();
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    fireEvent.input(screen.getByTestId("filepicker-input"), {
      target: { value: `${ROOT}/src/` },
    });
    await waitFor(() =>
      expect(screen.getByTestId("filepicker-suggestion-0")).toHaveTextContent("features"),
    );
    fireEvent.keyDown(screen.getByTestId("filepicker-input"), { key: "Enter" });
    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", {
        body: { title: undefined },
        query: { directory: `${ROOT}/src` },
      }),
    );
  });

  it("creates with the raw typed path when nothing matches", async () => {
    const client = mockClient();
    const props = renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    fireEvent.input(screen.getByTestId("filepicker-input"), {
      target: { value: "/custom/project" },
    });
    fireEvent.click(screen.getByTestId("filepicker-create"));
    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", {
        body: { title: undefined },
        query: { directory: "/custom/project" },
      }),
    );
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledTimes(1));
  });

  it("creates without a directory when the input is empty", async () => {
    const client = mockClient();
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("filepicker-create"));
    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", { body: { title: undefined } }),
    );
  });

  it("moves the selection with arrow keys over folders only", async () => {
    mockClient();
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    const input = screen.getByTestId("filepicker-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByTestId("filepicker-suggestion-1")).toHaveAttribute("data-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByTestId("filepicker-input")).toHaveValue(`${ROOT}/node_modules`),
    );
  });

  it("surfaces the listing load failure", async () => {
    const client = mockClient();
    client.get.mockRejectedValue({ code: "network", message: "connection refused" });
    renderPicker();

    await waitFor(() => expect(screen.getByTestId("filepicker-load-error")).toBeInTheDocument());
    expect(screen.getByTestId("filepicker-load-error")).toHaveTextContent("connection refused");
  });

  it("cancel closes the dialog", () => {
    mockClient();
    const props = renderPicker();
    fireEvent.click(screen.getByTestId("filepicker-cancel"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onCreated).not.toHaveBeenCalled();
  });
});
