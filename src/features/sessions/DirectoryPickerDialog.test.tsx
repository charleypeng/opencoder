// DirectoryPickerDialog tests (sessions add-directory flow): the browser
// behind the project switcher's ➕ — starts at the filesystem root,
// lists each directory's subfolders via GET /file with the `directory`
// query (workspace-routing), drills down on click, jumps back through the
// breadcrumb, and "Add directory" switches the working directory, jumps
// into it (selecting its first session — or creating one when the folder
// has no sessions yet) and records it as recent (deduped).

import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DirectoryPickerDialog from "./DirectoryPickerDialog";
import { getServerProjectState, resetServer } from "../../stores/project";
import { getServerSessionState, resetServer as resetSessions } from "../../stores/session";
import { readRecentProjects } from "./recentProjects";
import type { FileNode } from "../../services/file";
import type { Session } from "../../services/session";

const { getApiClientMock, openNativeDirectoryMock, listServersMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  openNativeDirectoryMock: vi.fn(),
  listServersMock: vi.fn(),
}));

vi.mock("../../services/client", () => ({ getApiClient: getApiClientMock }));
vi.mock("../../services/servers", () => ({ listServers: listServersMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openNativeDirectoryMock }));

const SERVER = "srv-dirpick";

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

function session(id: string, title = "Existing session"): Session {
  return {
    id,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    projectID: "p1",
    directory: "/Volumes/data",
    title,
    version: "1.18.11",
    time: { created: 1, updated: 1 },
  } as Session;
}

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
}

/** GET /file serves the directory listings, GET /session the sessions of
 *  the injected (new) active directory. */
function mockClient(sessions: Session[] = []): MockClient {
  const client: MockClient = {
    get: vi.fn(async (url: string, opts?: { query?: { path?: string; directory?: string } }) => {
      if (url === "/session") return sessions;
      const dir = opts?.query?.directory ?? "/";
      return (LISTINGS[dir] ?? []).map((name) => entry(dir, name));
    }),
    post: vi.fn(async () => session("sess_new", "")),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

function renderPicker(overrides: Partial<Parameters<typeof DirectoryPickerDialog>[0]> = {}) {
  const props = { serverId: SERVER, onClose: vi.fn(), ...overrides };
  render(() => <DirectoryPickerDialog {...props} />);
  return props;
}

/** Drills into /Volumes/data so Add targets a concrete folder. */
async function drillToData() {
  await waitFor(() =>
    expect(screen.getByTestId("directory-picker-item-Volumes")).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByTestId("directory-picker-item-Volumes"));
  await waitFor(() => expect(screen.getByTestId("directory-picker-item-data")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("directory-picker-item-data"));
  await waitFor(() =>
    expect(screen.getByTestId("directory-picker-item-project-a")).toBeInTheDocument(),
  );
}

describe("DirectoryPickerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the registry cannot be resolved (server list unavailable),
    // so the in-app browser is the fallback. Tests for the native path
    // override this with a localhost entry.
    listServersMock.mockRejectedValue(new Error("no registry"));
    // Default: the native system dialog is unavailable in tests, so the
    // in-app browser is the fallback. Tests for the native path override
    // this with mockResolvedValue.
    openNativeDirectoryMock.mockRejectedValue(new Error("no native dialog"));
    localStorage.clear();
    resetServer(SERVER);
    resetSessions(SERVER);
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

  it("opens already positioned at the initialDirectory (open-folder flow)", async () => {
    const client = mockClient();
    renderPicker({ initialDirectory: "/Volumes/data" });

    // The target directory's subfolders load immediately, no drill-down.
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-project-a")).toBeInTheDocument(),
    );
    expect(client.get).toHaveBeenCalledWith("/file", {
      query: { path: "", directory: "/Volumes/data" },
    });
    // The breadcrumb reflects the starting directory.
    const crumb = screen.getByTestId("directory-picker-crumb-/Volumes/data");
    expect(crumb).toBeInTheDocument();
    expect(crumb).toHaveAttribute("data-current", "true");
  });

  it("falls back to the root when initialDirectory is absent", async () => {
    const client = mockClient();
    renderPicker();
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-Volumes")).toBeInTheDocument(),
    );
    expect(client.get).toHaveBeenCalledWith("/file", {
      query: { path: "", directory: "/" },
    });
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

  it("adds the directory and creates a session when it has none", async () => {
    // No sessions exist in the picked folder.
    const client = mockClient([]);
    const props = renderPicker();
    await drillToData();

    fireEvent.click(screen.getByTestId("directory-picker-add"));

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", { body: { title: undefined } }),
    );
    // The created session becomes the active one (the jump target).
    await waitFor(() => {
      expect(getServerSessionState(SERVER).activeSessionId).toBe("sess_new");
    });
    expect(getServerProjectState(SERVER).current).toBe("/Volumes/data");
    // The folder lands in the recents (deduped: adding twice stays one).
    expect(readRecentProjects(SERVER)).toEqual(["/Volumes/data"]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("reports the added directory through onAdded (default-workspace flows)", async () => {
    mockClient([]);
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(() => <DirectoryPickerDialog serverId={SERVER} onClose={onClose} onAdded={onAdded} />);
    await drillToData();

    fireEvent.click(screen.getByTestId("directory-picker-add"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onAdded).toHaveBeenCalledWith("/Volumes/data");
    expect(onAdded).toHaveBeenCalledBefore(onClose);
  });

  it("adds the directory and selects its first session when sessions exist", async () => {
    const client = mockClient([session("sess_a", "First"), session("sess_b", "Second")]);
    renderPicker();
    await drillToData();

    fireEvent.click(screen.getByTestId("directory-picker-add"));

    // The existing session list is loaded (no creation) and the first
    // session is selected — the app jumps into the picked directory.
    await waitFor(() => expect(client.post).not.toHaveBeenCalled());
    await waitFor(() => expect(getServerSessionState(SERVER).activeSessionId).toBe("sess_a"));
    expect(getServerProjectState(SERVER).current).toBe("/Volumes/data");
  });

  it("still switches the directory when the session listing fails", async () => {
    const client = mockClient();
    client.get.mockImplementation(
      async (url: string, opts?: { query?: { directory?: string } }) => {
        if (url === "/session") throw new Error("list failed");
        const dir = opts?.query?.directory ?? "/";
        return (LISTINGS[dir] ?? []).map((name) => entry(dir, name));
      },
    );
    const props = renderPicker();
    await drillToData();

    fireEvent.click(screen.getByTestId("directory-picker-add"));

    // The switch happens regardless; the SSE re-sync settles sessions.
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(getServerProjectState(SERVER).current).toBe("/Volumes/data");
    expect(getServerSessionState(SERVER).activeSessionId).toBeNull();
  });

  it("surfaces a listing failure and disables Add", async () => {
    const client = mockClient();
    client.get.mockImplementation(async (url: string) => {
      if (url === "/session") return [];
      throw new Error("connection refused");
    });
    renderPicker();

    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-load-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("directory-picker-load-error")).toHaveTextContent(
      "connection refused",
    );
    expect(screen.getByTestId("directory-picker-add")).toBeDisabled();
  });

  it("cancel closes the dialog without touching the working directory", async () => {
    mockClient();
    const props = renderPicker();
    // The in-app browser renders once the native path falls back.
    await waitFor(() => expect(screen.getByTestId("directory-picker-cancel")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("directory-picker-cancel"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(getServerProjectState(SERVER).current).toBeNull();
  });

  it("falls back to the in-app browser when the registry cannot be resolved", async () => {
    mockClient();
    openNativeDirectoryMock.mockRejectedValue(new Error("dialog plugin missing"));
    renderPicker();
    // The in-app directory browser takes over.
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-Volumes")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("directory-picker-dialog")).toBeInTheDocument();
    expect(openNativeDirectoryMock).not.toHaveBeenCalled();
  });

  it("adds the directory picked through the native dialog for a localhost server", async () => {
    const client = mockClient([]);
    const onAdded = vi.fn();
    const onClose = vi.fn();
    listServersMock.mockResolvedValue([
      { id: SERVER, name: "Local", url: "http://localhost:3000", mode: "local" },
    ]);
    openNativeDirectoryMock.mockResolvedValue("/Volumes/data");

    render(() => (
      <DirectoryPickerDialog
        serverId={SERVER}
        initialDirectory="/Volumes"
        onClose={onClose}
        onAdded={onAdded}
      />
    ));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // The native dialog was used (local server) and the picked directory
    // becomes the working directory; the in-app browser never renders.
    expect(openNativeDirectoryMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      defaultPath: "/Volumes",
    });
    expect(client.post).toHaveBeenCalledWith("/session", { body: { title: undefined } });
    expect(getServerProjectState(SERVER).current).toBe("/Volumes/data");
    expect(onAdded).toHaveBeenCalledWith("/Volumes/data");
    expect(screen.queryByTestId("directory-picker-dialog")).toBeNull();
  });

  it("keeps the in-app browser for a remote server and never opens the native dialog", async () => {
    mockClient();
    listServersMock.mockResolvedValue([
      { id: SERVER, name: "Remote", url: "https://opencode.example.com" },
    ]);
    renderPicker();

    // The remote server cannot share this machine's filesystem, so the
    // in-app directory browser is used and the OS picker never opens.
    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-Volumes")).toBeInTheDocument(),
    );
    expect(openNativeDirectoryMock).not.toHaveBeenCalled();
  });

  it("keeps the in-app browser for a remote loopback URL", async () => {
    mockClient();
    listServersMock.mockResolvedValue([
      { id: SERVER, name: "Remote", url: "http://127.0.0.1:3000", mode: "remote" },
    ]);
    renderPicker();

    await waitFor(() =>
      expect(screen.getByTestId("directory-picker-item-Volumes")).toBeInTheDocument(),
    );
    expect(openNativeDirectoryMock).not.toHaveBeenCalled();
  });
});
