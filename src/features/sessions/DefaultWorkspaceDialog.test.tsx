// L2 tests for the default-workspace onboarding dialog (feat(default-workspace)):
// it renders the picker with onboarding copy + skip; adding a directory
// persists it as the server's default workspace and closes; skipping just
// closes without persisting.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import DefaultWorkspaceDialog from "./DefaultWorkspaceDialog";
import { readDefaultWorkspace } from "../servers/defaultWorkspace.js";
import { getServerProjectState, resetServer as resetProjects } from "../../stores/project";
import { resetServer as resetSessions } from "../../stores/session";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-dw-dialog";

function entry(dir: string, name: string) {
  return {
    name,
    path: `${name}/`,
    absolute: `${dir === "/" ? "" : dir}/${name}`,
    type: "directory" as const,
    ignored: false,
  };
}

const LISTINGS: Record<string, string[]> = {
  "/": ["Volumes"],
  "/Volumes": ["data"],
  "/Volumes/data": ["project-a"],
};

beforeEach(() => {
  resetSessions(SERVER);
  resetProjects(SERVER);
  localStorage.clear();
  getApiClientMock.mockReset();
  const client = {
    get: vi.fn(async (url: string, opts?: { query?: { directory?: string } }) => {
      if (url === "/session") return [];
      const dir = opts?.query?.directory ?? "/";
      return (LISTINGS[dir] ?? []).map((name) => entry(dir, name));
    }),
    post: vi.fn(async () => ({})),
    patch: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
});

function renderDialog(onClose: () => void = vi.fn()) {
  render(() => <DefaultWorkspaceDialog serverId={SERVER} onClose={onClose} />);
  return onClose;
}

describe("DefaultWorkspaceDialog", () => {
  it("renders the picker with onboarding copy and a skip button", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("directory-picker-dialog")).toBeInTheDocument());
    expect(screen.getByText("Choose a default workspace")).toBeInTheDocument();
    expect(screen.getByTestId("directory-picker-skip")).toBeInTheDocument();
    expect(screen.getByTestId("directory-picker-add")).toBeInTheDocument();
  });

  it("persists the picked folder as the default workspace and closes", async () => {
    const onClose = renderDialog();
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

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(readDefaultWorkspace(SERVER)).toBe("/Volumes/data");
    // The picked folder also lands in the explicit workspace list.
    expect(JSON.parse(localStorage.getItem("oc-workspaces:" + SERVER) ?? "[]")).toEqual([
      "/Volumes/data",
    ]);
    expect(getServerProjectState(SERVER).current).toBe("/Volumes/data");
  });

  it("skipping closes without persisting a default workspace", async () => {
    const onClose = renderDialog();
    await waitFor(() => expect(screen.getByTestId("directory-picker-skip")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("directory-picker-skip"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(readDefaultWorkspace(SERVER)).toBeNull();
  });
});
