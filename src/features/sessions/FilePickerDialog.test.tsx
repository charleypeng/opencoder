// FilePickerDialog tests (TASK-UI-01 filepicker): the project-directory
// picker behind the sessions "+" button — suggestion loading, case-
// insensitive filtering, keyboard navigation, picking vs raw-path input,
// and error surfaces.

import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FilePickerDialog from "./FilePickerDialog";
import type { Project } from "../../services/project";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client", () => ({ getApiClient: getApiClientMock }));

type MockClient = {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function mockClient(): MockClient {
  const client = {
    get: vi.fn(async () => []),
    post: vi.fn(async () => ({
      id: "sess_1",
      directory: "/mock/projects/opencode-demo",
      title: "",
      time: { created: 1, updated: 1 },
    })),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

function project(overrides: Partial<Project>): Project {
  return {
    id: "p1",
    worktree: "/mock/projects/opencode-demo",
    vcs: "git",
    name: "opencode-demo",
    time: { created: 1, updated: 1 },
    sandboxes: [],
    ...overrides,
  };
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

  it("loads the project list into suggestions", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([
      project({ id: "p1", worktree: "/mock/projects/opencode-demo" }),
      project({ id: "p2", worktree: "/mock/projects/opencode-labs", name: "opencode-labs" }),
    ]);
    renderPicker();

    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());
    expect(screen.getByTestId("filepicker-suggestion-0")).toHaveTextContent(
      "/mock/projects/opencode-demo",
    );
    expect(screen.getByTestId("filepicker-suggestion-1")).toHaveTextContent(
      "/mock/projects/opencode-labs",
    );
    expect(client.get).toHaveBeenCalledWith("/project", undefined);
  });

  it("filters suggestions case-insensitively by path or name", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([
      project({ id: "p1", worktree: "/mock/projects/opencode-demo", name: "demo" }),
      project({ id: "p2", worktree: "/mock/projects/opencode-labs", name: "labs" }),
    ]);
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    fireEvent.input(screen.getByTestId("filepicker-input"), {
      target: { value: "LABS" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("filepicker-suggestion-0")).toHaveTextContent("labs"),
    );
    expect(screen.queryByTestId("filepicker-suggestion-1")).toBeNull();
  });

  it("shows the empty state when nothing matches", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([project({})]);
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    fireEvent.input(screen.getByTestId("filepicker-input"), {
      target: { value: "nope" },
    });
    await waitFor(() => expect(screen.getByTestId("filepicker-empty")).toBeInTheDocument());
  });

  it("picking a suggestion fills the input and creating posts the directory", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([project({ worktree: "/mock/projects/opencode-demo" })]);
    const props = renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("filepicker-suggestion-0"));
    expect(screen.getByTestId("filepicker-input")).toHaveValue("/mock/projects/opencode-demo");

    fireEvent.click(screen.getByTestId("filepicker-create"));
    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", {
        body: { title: undefined },
        query: { directory: "/mock/projects/opencode-demo" },
      }),
    );
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledTimes(1));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("creates with the raw typed path when it matches no suggestion", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([project({ worktree: "/mock/projects/opencode-demo" })]);
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
    client.get.mockResolvedValue([project({})]);
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("filepicker-create"));
    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", { body: { title: undefined } }),
    );
  });

  it("moves the selection with arrow keys and Enter picks + creates", async () => {
    const client = mockClient();
    client.get.mockResolvedValue([
      project({ id: "p1", worktree: "/a/one" }),
      project({ id: "p2", worktree: "/b/two" }),
    ]);
    const props = renderPicker();
    await waitFor(() => expect(screen.getByTestId("filepicker-suggestion-0")).toBeInTheDocument());

    const input = screen.getByTestId("filepicker-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByTestId("filepicker-suggestion-1")).toHaveAttribute("data-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", {
        body: { title: undefined },
        query: { directory: "/b/two" },
      }),
    );
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledTimes(1));
  });

  it("surfaces the project-list load failure", async () => {
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
