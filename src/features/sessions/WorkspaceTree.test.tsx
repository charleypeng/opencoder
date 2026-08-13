// L2 tests for the workspace tree (sidebar nav redesign): folder →
// sessions grouping across directories (roots only), empty-folder
// completion from projects, expand/collapse with persistence, search
// filtering, session selection with directory switch, folder hover actions
// (open folder picker / remove from list), status dots, the session ⋯ menu
// (batch disabled placeholder, open folder, danger delete) and the empty
// state with the add-directory entry.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import WorkspaceTree from "./WorkspaceTree";
import type { Session } from "../../services/session";
import type { Project } from "../../services/project";
import { resetServer as resetModels } from "../../stores/models";
import {
  getServerProjectState,
  resetServer as resetProjects,
  setCurrent,
} from "../../stores/project";
import {
  applySessionList,
  getServerSessionState,
  resetServer as resetSessions,
  setSessionStatus,
  upsertSession,
} from "../../stores/session";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-workspace";

function session(
  id: string,
  directory: string,
  updated = 100,
  overrides: Partial<Session> = {},
): Session {
  return {
    id,
    slug: `slug-${id}`,
    projectID: "prj",
    directory,
    title: `Title ${id}`,
    version: "1.18.11",
    time: { created: updated, updated },
    ...overrides,
  } as Session;
}

function project(id: string, worktree: string, name?: string): Project {
  return {
    id,
    worktree,
    ...(name === undefined ? {} : { name }),
    time: { created: 1, updated: 1 },
    sandboxes: [],
  } as Project;
}

/** The cross-directory root sessions returned by GET /session?roots=true. */
const ROOTS = [
  session("s1", "/dev/opencoder", 300),
  session("s2", "/dev/opencoder", 200),
  session("s3", "/dev/hermes", 400),
  session("child", "/dev/opencoder", 250, { parentID: "s1" }),
];

const PROJECTS = [
  project("p-opencode", "/dev/opencoder", "opencoder"),
  project("p-hermes", "/dev/hermes"),
  project("p-empty", "/dev/daily"),
];

function mockClient(overrides: { roots?: Session[]; projects?: Project[] } = {}) {
  const roots = overrides.roots ?? ROOTS;
  const projects = overrides.projects ?? PROJECTS;
  const client = {
    get: vi.fn(async (path: string, opts?: { query?: { roots?: boolean } }) => {
      if (path === "/session") {
        return opts?.query?.roots ? roots : roots.filter((s) => s.parentID === undefined);
      }
      if (path === "/project") return projects;
      if (path.startsWith("/file")) return [];
      return [];
    }),
    post: vi.fn(async () => session("s-new", "/dev/opencoder")),
    patch: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

beforeEach(() => {
  resetSessions(SERVER);
  resetProjects(SERVER);
  resetModels(SERVER);
  localStorage.clear();
  getApiClientMock.mockReset();
  mockClient();
});

afterEach(() => {
  resetSessions(SERVER);
  resetProjects(SERVER);
});

function renderTree(onSelect: (id: string) => void = vi.fn()) {
  const result = render(() => <WorkspaceTree serverId={SERVER} onSelectSession={onSelect} />);
  return { ...result, onSelect };
}

describe("WorkspaceTree", () => {
  it("renders folders grouped by directory with their root sessions", async () => {
    renderTree();
    // Folder rows come from the fetched roots + projects (async).
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("workspace-folder-/dev/hermes")).toBeInTheDocument();
    // Subagent children never render in the tree.
    expect(screen.queryByTestId("workspace-session-child")).toBeNull();
    // Sessions render under their folder.
    expect(screen.getByTestId("workspace-session-s1")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-session-s2")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-session-s3")).toBeInTheDocument();
  });

  it("completes empty folders from projects with no sessions", async () => {
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("workspace-folder-/dev/daily")).toBeInTheDocument();
    expect(withinCount(screen.getByTestId("workspace-folder-/dev/daily"))).toBe(0);
  });

  it("collapses and expands a folder via its row", async () => {
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("workspace-session-s1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("workspace-folder-/dev/opencoder"));
    expect(screen.queryByTestId("workspace-session-s1")).toBeNull();

    fireEvent.click(screen.getByTestId("workspace-folder-/dev/opencoder"));
    await waitFor(() => expect(screen.getByTestId("workspace-session-s1")).toBeInTheDocument());
  });

  it("persists the collapsed state across renders", async () => {
    const { unmount } = renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("workspace-folder-/dev/opencoder"));
    expect(screen.queryByTestId("workspace-session-s1")).toBeNull();
    unmount();

    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("workspace-session-s1")).toBeNull();
  });

  it("selects a session and switches the directory context", async () => {
    const { onSelect } = renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-session-s3")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("workspace-session-s3"));
    // selectSession awaits the directory switch; settle the assertions.
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("s3"));
    expect(getServerSessionState(SERVER).activeSessionId).toBe("s3");
    expect(getServerProjectState(SERVER).current).toBe("/dev/hermes");
  });

  it("selects a session in the current directory without switching", async () => {
    setCurrent(SERVER, "/dev/opencoder");
    renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-session-s1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("workspace-session-s1"));
    expect(getServerSessionState(SERVER).activeSessionId).toBe("s1");
    expect(getServerProjectState(SERVER).current).toBe("/dev/opencoder");
  });

  it("filters sessions by search query and force-expands matches", async () => {
    const client = mockClient();
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    // Collapse the folder first: search must still reveal the match.
    fireEvent.click(screen.getByTestId("workspace-folder-/dev/opencoder"));

    fireEvent.input(screen.getByTestId("workspace-search"), { target: { value: "Title s3" } });
    await waitFor(() => expect(screen.getByTestId("workspace-session-s3")).toBeInTheDocument());
    // Non-matching folder disappears.
    expect(screen.queryByTestId("workspace-folder-/dev/opencoder")).toBeNull();
    void client;
  });

  it("hides a folder via the remove action and persists the hide", async () => {
    const { unmount } = renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    const removeButton = within(screen.getByTestId("workspace-folder-/dev/opencoder")).getByTestId(
      "workspace-folder-remove",
    );
    fireEvent.click(removeButton);
    await waitFor(() => expect(screen.queryByTestId("workspace-folder-/dev/opencoder")).toBeNull());
    expect(screen.getByTestId("workspace-folder-/dev/hermes")).toBeInTheDocument();
    unmount();

    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/hermes")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("workspace-folder-/dev/opencoder")).toBeNull();
  });

  it("opens the directory picker positioned at the folder", async () => {
    const client = mockClient();
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    const openButton = within(screen.getByTestId("workspace-folder-/dev/opencoder")).getByTestId(
      "workspace-folder-open",
    );
    fireEvent.click(openButton);
    await waitFor(() => expect(screen.getByTestId("directory-picker-dialog")).toBeInTheDocument());
    // The picker lists the folder's own directory.
    expect(client.get).toHaveBeenCalledWith("/file", {
      query: { path: "", directory: "/dev/opencoder" },
    });
  });

  it("shows a busy status dot on folders with running sessions", async () => {
    applySessionList(SERVER, ROOTS);
    setSessionStatus(SERVER, "s1", { type: "busy" });
    setCurrent(SERVER, "/dev/opencoder");
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    const status = screen.getByTestId("workspace-folder-status");
    expect(status).toHaveAttribute("data-status", "busy");
  });

  it("opens the session ⋯ menu with batch placeholder and danger delete", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-session-s1")).toBeInTheDocument());
    const menuButton = within(screen.getByTestId("workspace-session-s1")).getByTestId(
      "workspace-session-menu",
    );
    fireEvent.click(menuButton);
    await waitFor(() =>
      expect(screen.getByTestId("workspace-session-menu-open-folder")).toBeInTheDocument(),
    );
    // Batch actions are a disabled placeholder.
    const batch = screen.getByTestId("workspace-session-menu-batch");
    expect(batch).toBeDisabled();
    // Delete renders with danger styling.
    expect(screen.getByTestId("workspace-session-menu-delete")).toBeInTheDocument();
  });

  it("renders the empty state with an add-directory entry", async () => {
    mockClient({ roots: [], projects: [] });
    renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-empty")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("workspace-empty-add"));
    await waitFor(() => expect(screen.getByTestId("directory-picker-dialog")).toBeInTheDocument());
  });

  it("syncs in-place upserts from the global store (shared badge toggles)", async () => {
    mockClient({ roots: [session("s1", "/dev/opencoder")] });
    renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-session-s1")).toBeInTheDocument());
    // No share marker yet.
    expect(screen.queryByTestId("workspace-session-shared-badge")).toBeNull();

    // Share: the global store upserts the session WITH the share marker.
    upsertSession(SERVER, { ...session("s1", "/dev/opencoder"), share: { url: "https://x" } });
    await waitFor(() =>
      expect(screen.getByTestId("workspace-session-shared-badge")).toBeInTheDocument(),
    );

    // Unshare: the upsert clears the marker; the tree must drop the badge.
    upsertSession(SERVER, session("s1", "/dev/opencoder"));
    await waitFor(() => expect(screen.queryByTestId("workspace-session-shared-badge")).toBeNull());
  });
});

/** Session count badge text of a folder row ("" when absent). */
function withinCount(row: HTMLElement): number {
  const badge = row.querySelector('[data-testid="workspace-folder-count"]');
  return badge === null ? 0 : Number(badge.textContent);
}
