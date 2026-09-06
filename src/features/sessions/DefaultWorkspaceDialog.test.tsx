// L2 tests for the default-workspace onboarding dialog (feat(default-workspace)):
// it first renders an app-owned prompt without invoking the system picker;
// choosing a folder opens the picker, persists the selected workspace, and
// skipping closes without persisting.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import DefaultWorkspaceDialog from "./DefaultWorkspaceDialog";
import { readDefaultWorkspace } from "../servers/defaultWorkspace.js";
import { getServerProjectState, resetServer as resetProjects } from "../../stores/project";
import { resetServer as resetSessions } from "../../stores/session";

const { getApiClientMock, listServersMock, openNativeDirectoryMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  listServersMock: vi.fn(),
  openNativeDirectoryMock: vi.fn(),
}));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));
vi.mock("../../services/servers.js", () => ({ listServers: listServersMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openNativeDirectoryMock }));

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
  listServersMock.mockRejectedValue(new Error("no registry"));
  openNativeDirectoryMock.mockRejectedValue(new Error("no native dialog"));
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
  it("shows an app-owned onboarding prompt before the native picker", () => {
    renderDialog();
    expect(screen.getByTestId("default-workspace-onboarding")).toBeInTheDocument();
    expect(screen.getByText("Choose a default workspace")).toBeInTheDocument();
    expect(screen.getByTestId("default-workspace-skip")).toBeInTheDocument();
    expect(screen.getByTestId("default-workspace-choose")).toBeInTheDocument();
    expect(screen.queryByTestId("directory-picker-dialog")).toBeNull();
    expect(openNativeDirectoryMock).not.toHaveBeenCalled();
  });

  it("persists the picked folder as the default workspace and closes", async () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByTestId("default-workspace-choose"));
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
    fireEvent.click(screen.getByTestId("default-workspace-skip"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(readDefaultWorkspace(SERVER)).toBeNull();
  });

  it("opens the native picker only after the user chooses a folder", async () => {
    listServersMock.mockResolvedValue([
      { id: SERVER, name: "Local", url: "http://localhost:3000", mode: "local" },
    ]);
    openNativeDirectoryMock.mockResolvedValue("/Volumes/data");
    const onClose = renderDialog();

    expect(openNativeDirectoryMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("default-workspace-choose"));

    await waitFor(() => expect(openNativeDirectoryMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(readDefaultWorkspace(SERVER)).toBe("/Volumes/data");
  });

  it("closes after a native-picker cancellation without persisting a workspace", async () => {
    listServersMock.mockResolvedValue([
      { id: SERVER, name: "Local", url: "http://localhost:3000", mode: "local" },
    ]);
    openNativeDirectoryMock.mockResolvedValue(null);
    const onClose = renderDialog();

    fireEvent.click(screen.getByTestId("default-workspace-choose"));

    await waitFor(() => expect(openNativeDirectoryMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(readDefaultWorkspace(SERVER)).toBeNull();
  });
});
