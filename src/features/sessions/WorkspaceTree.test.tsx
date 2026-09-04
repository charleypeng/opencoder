// L2 tests for the workspace tree (sidebar nav redesign): folder →
// sessions grouping across directories (roots only), empty-folder
// completion from projects, expand/collapse with persistence, search
// filtering, session selection with directory switch, folder hover actions
// (open folder picker / remove from list), status dots, the session ⋯ menu
// (batch selection, open folder, danger delete) and the empty
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
import { setDefaultWorkspace } from "../servers/defaultWorkspace";
import { addWorkspace, clearWorkspaces } from "./workspaces";

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
    post: vi.fn<(path: string, opts?: unknown) => Promise<Session>>(async () =>
      session("s-new", "/dev/opencoder"),
    ),
    patch: vi.fn<(path: string, opts?: unknown) => Promise<unknown>>(async () => undefined),
    delete: vi.fn<(path: string, opts?: unknown) => Promise<unknown>>(async () => true),
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

function renderTree(
  onSelect: (id: string) => void = vi.fn(),
  onViewFolder: (dir: string) => void = vi.fn(),
) {
  const result = render(() => (
    <WorkspaceTree serverId={SERVER} onSelectSession={onSelect} onViewFolder={onViewFolder} />
  ));
  return { ...result, onSelect, onViewFolder };
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
    const sessionRow = screen.getByTestId("workspace-session-s1");
    expect(within(sessionRow).getByTestId("workspace-session-title")).toHaveClass("text-xs");
    expect(screen.getByTestId("workspace-new-session")).toHaveClass("text-xs");
    expect(sessionRow.querySelector(".font-code")).toBeNull();
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

  it("switches the workspace folder icon between open and closed states", async () => {
    renderTree();
    const row = await screen.findByTestId("workspace-folder-/dev/opencoder");
    expect(within(row).getByTestId("workspace-folder-icon")).toHaveAttribute("data-state", "open");
    expect(within(row).getByTestId("workspace-folder-open-outline")).toBeInTheDocument();
    expect(within(row).queryByTestId("workspace-folder-closed-outline")).toBeNull();

    fireEvent.click(row);
    expect(within(row).getByTestId("workspace-folder-icon")).toHaveAttribute(
      "data-state",
      "closed",
    );
    expect(within(row).getByTestId("workspace-folder-closed-outline")).toBeInTheDocument();
    expect(within(row).queryByTestId("workspace-folder-open-outline")).toBeNull();
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

  it("a snapshot refresh drops sessions the server no longer lists (deleted sessions leave the tree)", async () => {
    // Solid's setStore MERGES plain objects, so replacing the snapshot with
    // a plain object kept deleted sessions in the tree forever (the delete
    // flow's refresh never removed the row). applyLocalList must replace
    // wholesale.
    let list = [
      session("s1", "/dev/opencoder", 300),
      session("s2", "/dev/opencoder", 200),
      session("s3", "/dev/hermes", 400),
    ];
    const client = mockClient();
    client.get.mockImplementation(async (path: string) => {
      if (path === "/session") return list;
      if (path === "/project") return PROJECTS;
      return [];
    });
    renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-session-s2")).toBeInTheDocument());

    // The server-side session is deleted; the next refresh's response omits it.
    list = [session("s1", "/dev/opencoder", 300), session("s3", "/dev/hermes", 400)];
    // Collapse then re-expand the folder to trigger a refresh (toggleFolder
    // re-syncs on expand).
    fireEvent.click(screen.getByTestId("workspace-folder-/dev/opencoder"));
    fireEvent.click(screen.getByTestId("workspace-folder-/dev/opencoder"));
    await waitFor(() => expect(screen.queryByTestId("workspace-session-s2")).toBeNull());
    // The remaining sessions still render.
    expect(screen.getByTestId("workspace-session-s1")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-session-s3")).toBeInTheDocument();
  });

  it("removes a workspace via the ⋯ menu and persists the removal", async () => {
    const { unmount } = renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    fireEvent.click(
      within(screen.getByTestId("workspace-folder-/dev/opencoder")).getByTestId(
        "workspace-folder-more",
      ),
    );
    fireEvent.click(await screen.findByTestId("workspace-folder-menu-remove-workspace"));
    await waitFor(() => expect(screen.queryByTestId("workspace-folder-/dev/opencoder")).toBeNull());
    expect(screen.getByTestId("workspace-folder-/dev/hermes")).toBeInTheDocument();
    unmount();

    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/hermes")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("workspace-folder-/dev/opencoder")).toBeNull();
  });

  it("the ⋯ menu's view folder reports the workspace directory", async () => {
    const { onViewFolder } = renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    fireEvent.click(
      within(screen.getByTestId("workspace-folder-/dev/opencoder")).getByTestId(
        "workspace-folder-more",
      ),
    );
    fireEvent.click(await screen.findByTestId("workspace-folder-menu-view-folder"));
    expect(onViewFolder).toHaveBeenCalledWith("/dev/opencoder");
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

  it("opens the session ⋯ menu with batch action and danger delete", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-session-s1")).toBeInTheDocument());
    expect(screen.queryByTestId("workspace-batch-toggle")).toBeNull();
    const menuButton = within(screen.getByTestId("workspace-session-s1")).getByTestId(
      "workspace-session-menu",
    );
    fireEvent.click(menuButton);
    await waitFor(() =>
      expect(screen.getByTestId("workspace-session-menu-open-folder")).toBeInTheDocument(),
    );
    // Batch actions enter the checkable tree mode.
    const batch = screen.getByTestId("workspace-session-menu-batch");
    expect(batch).toBeEnabled();
    // Delete remains available as a separate danger action in the menu.
    expect(screen.getByTestId("workspace-session-menu-delete")).toBeInTheDocument();
    fireEvent.click(batch);
    expect(screen.getByTestId("workspace-batch-bar")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-session-select-s1")).toBeChecked();
  });

  it("deletes selected sessions only after every API request succeeds", async () => {
    const client = mockClient();
    renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-session-s1")).toBeInTheDocument());
    fireEvent.click(
      within(screen.getByTestId("workspace-session-s1")).getByTestId("workspace-session-menu"),
    );
    fireEvent.click(await screen.findByTestId("workspace-session-menu-batch"));
    fireEvent.click(screen.getByTestId("workspace-select-all"));
    expect(screen.getByTestId("workspace-selection-count")).toHaveTextContent("3");

    fireEvent.click(screen.getByTestId("workspace-batch-delete"));
    await waitFor(() => expect(client.delete).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByTestId("workspace-batch-bar")).toBeNull());
  });

  it("keeps failed sessions selected and reports partial batch failures", async () => {
    const client = mockClient();
    client.delete
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(true);
    renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-session-s1")).toBeInTheDocument());
    fireEvent.click(
      within(screen.getByTestId("workspace-session-s1")).getByTestId("workspace-session-menu"),
    );
    fireEvent.click(await screen.findByTestId("workspace-session-menu-batch"));
    fireEvent.click(screen.getByTestId("workspace-session-select-s2"));
    fireEvent.click(screen.getByTestId("workspace-batch-delete"));

    await waitFor(() => expect(screen.getByTestId("workspace-batch-error")).toBeInTheDocument());
    expect(screen.getByTestId("workspace-session-s2")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-session-select-s2")).toBeChecked();
  });

  it("archives sessions only when the server confirms the archive", async () => {
    const client = mockClient();
    client.patch.mockResolvedValue({ time: { archived: 123 } });
    renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-session-s1")).toBeInTheDocument());
    fireEvent.click(
      within(screen.getByTestId("workspace-session-s1")).getByTestId("workspace-session-menu"),
    );
    fireEvent.click(await screen.findByTestId("workspace-session-menu-batch"));
    fireEvent.click(screen.getByTestId("workspace-batch-archive"));

    await waitFor(() =>
      expect(client.patch).toHaveBeenCalledWith(
        "/session/s1",
        expect.objectContaining({
          body: expect.objectContaining({
            time: expect.objectContaining({ archived: expect.any(Number) }),
          }),
          query: { directory: "/dev/opencoder" },
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByTestId("workspace-batch-bar")).toBeNull());
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

describe("WorkspaceTree default workspace (workspace layout redesign)", () => {
  beforeEach(() => {
    localStorage.removeItem("oc-default-workspace:" + SERVER);
  });

  it("pins the default workspace on top with a badge and a divider", async () => {
    localStorage.setItem("oc-default-workspace:" + SERVER, JSON.stringify("/dev/hermes"));
    // Once any workspace is persisted the tree is strictly the explicit
    // list + default, so the other workspace must be added explicitly.
    localStorage.setItem("oc-workspaces:" + SERVER, JSON.stringify(["/dev/opencoder"]));
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/hermes")).toBeInTheDocument(),
    );

    // The default row carries the badge and the default marker.
    const defaultRow = screen.getByTestId("workspace-folder-/dev/hermes");
    expect(defaultRow).toHaveAttribute("data-default", "true");
    expect(within(defaultRow).getByTestId("workspace-folder-default-badge")).toHaveTextContent(
      "Default",
    );
    expect(within(defaultRow).getByTestId("workspace-folder-actions")).toBeInTheDocument();
    // A divider separates it from the remaining workspaces.
    const divider = screen.getByTestId("workspace-divider");
    const defaultNext = divider.compareDocumentPosition(
      screen.getByTestId("workspace-folder-section-/dev/opencoder"),
    );
    expect(defaultNext & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("expands the default workspace to its sessions (Bug: counted, never shown)", async () => {
    localStorage.setItem("oc-default-workspace:" + SERVER, JSON.stringify("/dev/hermes"));
    localStorage.setItem("oc-workspaces:" + SERVER, JSON.stringify(["/dev/opencoder"]));
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/hermes")).toBeInTheDocument(),
    );

    // The default row's count badge and its session list must agree: s3 is
    // the /dev/hermes root session, and it renders under the default row
    // while the folder is expanded (previously the default folder rendered
    // only its header — the count showed N sessions that could never be
    // expanded into view).
    const defaultRow = screen.getByTestId("workspace-folder-/dev/hermes");
    await waitFor(() =>
      expect(within(defaultRow).getByTestId("workspace-folder-count")).toHaveTextContent("1"),
    );
    const sessionRow = screen.getByTestId("workspace-session-s3");
    expect(sessionRow.textContent).toContain("Title s3");

    // Collapsing hides the sessions; the header (and its count) stays.
    fireEvent.click(within(defaultRow).getByTestId("workspace-folder-toggle"));
    expect(screen.queryByTestId("workspace-session-s3")).toBeNull();
    expect(within(defaultRow).getByTestId("workspace-folder-count")).toHaveTextContent("1");
  });

  it("renders the default workspace even with no sessions or project", async () => {
    // A default workspace with NO sessions and NO project record still
    // shows (pinned, with the badge) — the user asked for it explicitly.
    localStorage.setItem("oc-default-workspace:" + SERVER, JSON.stringify("/custom/empty"));
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/custom/empty")).toBeInTheDocument(),
    );
    const row = screen.getByTestId("workspace-folder-/custom/empty");
    expect(row).toHaveAttribute("data-default", "true");
    expect(within(row).getByTestId("workspace-folder-default-badge")).toBeInTheDocument();
  });

  it("the header add-workspace button opens the directory picker", async () => {
    renderTree();
    fireEvent.click(screen.getByTestId("workspace-add-workspace"));
    await waitFor(() => expect(screen.getByTestId("directory-picker-dialog")).toBeInTheDocument());
  });

  it("the header new-session button creates in the default workspace", async () => {
    const client = mockClient();
    localStorage.setItem("oc-default-workspace:" + SERVER, JSON.stringify("/dev/hermes"));
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/hermes")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("workspace-new-session"));
    await waitFor(() => expect(client.post).toHaveBeenCalled());
    // POST /session carries the default directory.
    const createCall = client.post.mock.calls.find(([path]) => path === "/session");
    expect(createCall).toBeDefined();
    expect(createCall![1]).toEqual({
      body: { title: undefined },
      query: { directory: "/dev/hermes" },
    });
  });

  it("the folder [+] button creates a session in that workspace", async () => {
    const client = mockClient();
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    fireEvent.click(
      within(screen.getByTestId("workspace-folder-/dev/opencoder")).getByTestId(
        "workspace-folder-add",
      ),
    );
    await waitFor(() => expect(client.post).toHaveBeenCalled());
    const createCall = client.post.mock.calls.find(([path]) => path === "/session");
    expect(createCall![1]).toEqual({
      body: { title: undefined },
      query: { directory: "/dev/opencoder" },
    });
  });

  it("an explicitly added workspace with no sessions renders and persists", async () => {
    localStorage.setItem("oc-workspaces:" + SERVER, JSON.stringify(["/custom/path"]));
    const { unmount } = renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/custom/path")).toBeInTheDocument(),
    );
    unmount();

    // After a re-mount (restart) the workspace is still listed.
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/custom/path")).toBeInTheDocument(),
    );
  });

  it("removing a workspace drops it from the persisted list too", async () => {
    localStorage.setItem("oc-workspaces:" + SERVER, JSON.stringify(["/custom/path"]));
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/custom/path")).toBeInTheDocument(),
    );
    fireEvent.click(
      within(screen.getByTestId("workspace-folder-/custom/path")).getByTestId(
        "workspace-folder-more",
      ),
    );
    fireEvent.click(await screen.findByTestId("workspace-folder-menu-remove-workspace"));
    await waitFor(() => expect(screen.queryByTestId("workspace-folder-/custom/path")).toBeNull());
    expect(JSON.parse(localStorage.getItem("oc-workspaces:" + SERVER) ?? "[]")).toEqual([]);
  });

  it("renders a default workspace set at runtime without a remount (Bug 1)", async () => {
    // Bug 1: a default workspace picked in onboarding (or set from Settings)
    // AFTER the tree mounted must appear immediately. The tree listens to
    // WORKSPACE_STORAGE_EVENT and refreshes its default + explicit signals.
    mockClient({ roots: [], projects: [] });
    renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-empty")).toBeInTheDocument());
    setDefaultWorkspace(SERVER, "/runtime/default");
    addWorkspace(SERVER, "/runtime/default");
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/runtime/default")).toBeInTheDocument(),
    );
    const row = screen.getByTestId("workspace-folder-/runtime/default");
    expect(row).toHaveAttribute("data-default", "true");
    expect(within(row).getByTestId("workspace-folder-default-badge")).toBeInTheDocument();
  });

  it("once a workspace is added the tree shows ONLY the explicit list (Bug 3)", async () => {
    // Bug 3: workspaces are never auto-filled from the server's history.
    // With no explicit/default list the tree falls back to the derived
    // directories; the moment the user adds one, the tree becomes strictly
    // that list — historical directories stay hidden until added by hand.
    mockClient({ roots: ROOTS, projects: PROJECTS });
    renderTree();
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/hermes")).toBeInTheDocument(),
    );
    // Adding a workspace restricts the tree to the explicit list only.
    addWorkspace(SERVER, "/dev/opencoder");
    await waitFor(() =>
      expect(screen.getByTestId("workspace-folder-/dev/opencoder")).toBeInTheDocument(),
    );
    // Other historical directories disappear (not auto-filled).
    expect(screen.queryByTestId("workspace-folder-/dev/hermes")).toBeNull();
  });

  it("clearWorkspaces empties the persisted list and notifies the tree (Bug 3 cleanup)", async () => {
    localStorage.setItem("oc-workspaces:" + SERVER, JSON.stringify(["/keep"]));
    renderTree();
    await waitFor(() => expect(screen.getByTestId("workspace-folder-/keep")).toBeInTheDocument());
    clearWorkspaces(SERVER);
    await waitFor(() => expect(screen.queryByTestId("workspace-folder-/keep")).toBeNull());
    expect(localStorage.getItem("oc-workspaces:" + SERVER)).toBeNull();
  });
});

/** Session count badge text of a folder row ("" when absent). */
function withinCount(row: HTMLElement): number {
  const badge = row.querySelector('[data-testid="workspace-folder-count"]');
  return badge === null ? 0 : Number(badge.textContent);
}
