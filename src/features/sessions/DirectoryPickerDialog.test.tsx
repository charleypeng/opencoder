// DirectoryPickerDialog tests (sessions add-directory flow): the browser
// behind the project switcher's ➕ — starts at the filesystem root,
// lists each directory's subfolders via GET /file with the `directory`
// query (workspace-routing), drills down on click, jumps back through the
// breadcrumb, and "Add directory" sets the picked folder as the current
// working directory (project store) plus records it as recent.

import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DirectoryPickerDialog from "./DirectoryPickerDialog";
import { getServerProjectState, resetServer } from "../../stores/project";
import { readRecentProjects } from "./recentProjects";
import type { FileNode } from "../../services/file";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-dirpick";

type MockClient = { get: ReturnType<typeof vi.fn> };

/** Per-directory listings keyed by the requested `directory` context. */
const LISTINGS: Record<string, string[]> = {
  "/": ["Volumes", "Users"],
  "/Volumes": ["data"],
  "/Volumes/data": ["project-a"],
};

function entry(dir: string, name: string): FileNode {
  const absolute = `${dir === "/" ? "" : dir}/${name}`;
  return {
    name,
    path: `${name}/`,
    absolute,
    type: "directory",
    ignored: false,
  };
}

function mockClient(): MockClient {
  const client = {
    get: vi.fn(async (_url: string, opts?: { query?: { path?: string; directory?: string } }) => {
      const dir = opts?.query?.directory ?? "/";
      return (LISTINGS[dir] ?? []).map((name) => entry(dir, name));
    }),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

function renderPicker(overrides: Partial<Parameters<typeof DirectoryPickerDialog>[0]> = {}) {
  const props = { serverId: SERVER, onClose: vi.fn(), ...overrides };
  render(() => <DirectoryPickerDialog {...props} />);
  return props;
}

describe("DirectoryPickerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetServer(SERVER);
  });

  it("starts at the filesystem root and lists its subfolders", async () => {
    const client = mockClient();
    renderPicker();

    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-Volumes")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("directory-picker-item-Users")).toBeInTheDocument();
    // The root listing is requested in the root's own directory context.
    expect(client.get).toHaveBeenCalledWith("/file", {
      query: { path: "", directory: "/" },
    });
    // Files are never shown — only folders are pickable.
    expect(screen.queryByTestId("directory-picker-item-README.md")).toBeNull();
  });

  it("drills into a folder on click and re-lists its subfolders", async () => {
    const client = mockClient();
    renderPicker();
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-Volumes")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("directory-picker-item-Volumes"));
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-data")).toBeInTheDocument(),
    );
    expect(client.get).toHaveBeenCalledWith("/file", {
      query: { path: "", directory: "/Volumes" },
    });

    fireEvent.click(screen.getByTestId("directory-picker-item-data"));
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-project-a")).toBeInTheDocument(),
    );
    expect(client.get).toHaveBeenCalledWith("/file", {
      query: { path: "", directory: "/Volumes/data" },
    });
  });

  it("jumps back through the breadcrumb", async () => {
    mockClient();
    renderPicker();
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-Volumes")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("directory-picker-item-Volumes"));
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-data")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("directory-picker-crumb-/"));
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-Volumes")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("directory-picker-item-data")).toBeNull();
  });

  it("adds the browsed directory as the working directory and closes", async () => {
    mockClient();
    const props = renderPicker();
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-Volumes")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("directory-picker-item-Volumes"));
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-data")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("directory-picker-item-data"));
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-project-a")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("directory-picker-add"));
    expect(getServerProjectState(SERVER).current).toBe("/Volumes/data");
    expect(readRecentProjects(SERVER)).toContain("/Volumes/data");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces a listing failure and disables Add", async () => {
    const client = mockClient();
    client.get.mockRejectedValue({ code: "network", message: "connection refused" });
    renderPicker();

    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-load-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("directory-picker-load-error")).toHaveTextContent(
      "connection refused",
    );
    expect(screen.getByTestId("directory-picker-add")).toBeDisabled();
  });

  it("cancel closes the dialog without touching the working directory", () => {
    mockClient();
    const props = renderPicker();
    fireEvent.click(screen.getByTestId("directory-picker-cancel"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(getServerProjectState(SERVER).current).toBeNull();
  });
});
