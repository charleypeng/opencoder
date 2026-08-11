// L2 tests for the project/folder switcher (TASK-M2-03): loads the server's
// projects into the project store, shows the current project with its path,
// opens a menu listing all projects with the current one highlighted,
// switching records the project as recent (localStorage) and changes the
// active directory, and the empty state renders when nothing is open.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import ProjectSwitcher from "./ProjectSwitcher";
import { getServerProjectState, resetServer } from "../../stores/project";
import type { Project } from "../../services/project";

const { getApiClientMock, projectGetMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  projectGetMock: vi.fn(),
}));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-proj";

function project(id: string, worktree: string, name: string): Project {
  return {
    id,
    worktree,
    name,
    time: { created: 1, updated: 1 },
    sandboxes: [],
  } as Project;
}

const DEMO = project("project-mock-1", "/mock/projects/opencode-demo", "opencode-demo");
const LABS = project("project-mock-2", "/mock/projects/opencode-labs", "opencode-labs");

beforeEach(() => {
  localStorage.clear();
  resetServer(SERVER);
  projectGetMock.mockReset();
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue({ get: projectGetMock });
});

afterEach(() => {
  localStorage.clear();
  resetServer(SERVER);
});

function mockProjects(current: Project | null | undefined) {
  projectGetMock.mockImplementation((path: string) => {
    if (path === "/project") return Promise.resolve([DEMO, LABS]);
    if (path === "/project/current") return Promise.resolve(current);
    return Promise.resolve(undefined);
  });
}

function openMenu() {
  fireEvent.pointerDown(screen.getByTestId("project-switcher-trigger"), {
    pointerType: "mouse",
  });
}

describe("ProjectSwitcher", () => {
  it("loads the server's projects and shows the current project with its path", async () => {
    mockProjects(DEMO);
    render(() => <ProjectSwitcher serverId={SERVER} />);

    await waitFor(() => expect(screen.getByText("opencode-demo")).toBeInTheDocument());
    expect(screen.getByText(DEMO.worktree)).toBeInTheDocument();
    expect(getServerProjectState(SERVER).projects).toEqual([DEMO, LABS]);
    expect(getServerProjectState(SERVER).current).toBe(DEMO.worktree);
  });

  it("opens the menu with all projects and the current one highlighted", async () => {
    mockProjects(DEMO);
    render(() => <ProjectSwitcher serverId={SERVER} />);
    await waitFor(() => expect(screen.getByText("opencode-demo")).toBeInTheDocument());

    openMenu();
    await waitFor(() =>
      expect(screen.getByTestId("project-switcher-item-project-mock-1")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("project-switcher-all")).toBeInTheDocument();
    expect(screen.getByTestId("project-switcher-item-project-mock-1")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("project-switcher-item-project-mock-2")).toHaveAttribute(
      "data-active",
      "false",
    );
    expect(screen.queryByTestId("project-switcher-recent")).toBeNull();
  });

  it("switching a project updates the context, records it as recent and shows the recent section", async () => {
    mockProjects(DEMO);
    render(() => <ProjectSwitcher serverId={SERVER} />);
    await waitFor(() => expect(screen.getByText("opencode-demo")).toBeInTheDocument());

    openMenu();
    await waitFor(() =>
      expect(screen.getByTestId("project-switcher-item-project-mock-2")).toBeInTheDocument(),
    );
    fireEvent.pointerUp(screen.getByTestId("project-switcher-item-project-mock-2"), {
      pointerType: "mouse",
    });

    await waitFor(() => expect(getServerProjectState(SERVER).current).toBe(LABS.worktree));
    expect(JSON.parse(localStorage.getItem("oc-recent-projects:srv-proj") ?? "[]")).toEqual([
      LABS.worktree,
    ]);
    await waitFor(() => expect(screen.getByText("opencode-labs")).toBeInTheDocument());

    // Re-opening shows the recent entry above the full list, highlighted.
    openMenu();
    await waitFor(() => expect(screen.getByTestId("project-switcher-recent")).toBeInTheDocument());
    const recentItem = screen.getByTestId("project-switcher-recent-project-mock-2");
    expect(recentItem).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("project-switcher-all")).toBeInTheDocument();

    // Selecting the already-active project is a no-op for recents.
    fireEvent.pointerUp(screen.getByTestId("project-switcher-item-project-mock-2"), {
      pointerType: "mouse",
    });
    await waitFor(() => expect(screen.queryByTestId("project-switcher-recent")).toBeNull());
    expect(JSON.parse(localStorage.getItem("oc-recent-projects:srv-proj") ?? "[]")).toEqual([
      LABS.worktree,
    ]);
  });

  it("shows the empty state when the server has no projects", async () => {
    projectGetMock.mockImplementation((path: string) => {
      if (path === "/project") return Promise.resolve([]);
      if (path === "/project/current") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    render(() => <ProjectSwitcher serverId={SERVER} />);

    openMenu();
    await waitFor(() => expect(screen.getByTestId("project-switcher-empty")).toBeInTheDocument());
    expect(screen.getByText("No projects found")).toBeInTheDocument();
    expect(getServerProjectState(SERVER).current).toBeNull();
  });

  it("keeps the previous state when the server is unreachable", async () => {
    projectGetMock.mockRejectedValue(new Error("network down"));
    render(() => <ProjectSwitcher serverId="srv-other" />);
    await waitFor(() => expect(screen.getByText("Select project")).toBeInTheDocument());
    expect(getServerProjectState("srv-other").projects).toEqual([]);
    expect(getServerProjectState("srv-other").current).toBeNull();
  });

  it("opens the add-directory picker from the menu's ➕ button", async () => {
    mockProjects(DEMO);
    render(() => <ProjectSwitcher serverId={SERVER} />);
    await waitFor(() => expect(screen.getByText("opencode-demo")).toBeInTheDocument());

    openMenu();
    await waitFor(() =>
      expect(screen.getByTestId("project-switcher-item-project-mock-1")).toBeInTheDocument(),
    );
    // The ➕ sits in the menu header's top-right corner.
    fireEvent.click(screen.getByTestId("project-switcher-add"));

    await waitFor(() => expect(screen.getByTestId("directory-picker-dialog")).toBeInTheDocument());
    expect(screen.queryByTestId("project-switcher-item-project-mock-1")).toBeNull();
  });
});
