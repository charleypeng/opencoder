// L2 tests for the updates settings section (TASK-M8-09): the version
// readout, the manual check flow (checking spinner → up to date / update
// available / error), the install flow (download progress → relaunch) and
// the percentOf helper. The updates facade is mocked: outside Tauri the
// real one would no-op, so these tests drive every state explicitly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import UpdatesSection, { percentOf } from "./UpdatesSection.js";

const { getAppVersionMock, checkForUpdatesMock, installAndRelaunchMock } = vi.hoisted(() => ({
  getAppVersionMock: vi.fn(),
  checkForUpdatesMock: vi.fn(),
  installAndRelaunchMock: vi.fn(),
}));

vi.mock("../../services/updates.js", () => ({
  checkForUpdates: checkForUpdatesMock,
  getAppVersion: getAppVersionMock,
  installAndRelaunch: installAndRelaunchMock,
}));

function availableUpdate(version = "2.0.0") {
  return { version, downloadAndInstall: vi.fn() };
}

beforeEach(() => {
  getAppVersionMock.mockReset();
  checkForUpdatesMock.mockReset();
  installAndRelaunchMock.mockReset();
  getAppVersionMock.mockResolvedValue("0.1.0");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("percentOf", () => {
  it("rounds the fraction to a clamped percent", () => {
    expect(percentOf({ downloaded: 30, total: 100, fraction: 0.3 })).toBe(30);
    expect(percentOf({ downloaded: 100, total: 100, fraction: 1 })).toBe(100);
    expect(percentOf({ downloaded: 50, total: 100, fraction: 1.5 })).toBe(100);
    expect(percentOf({ downloaded: 50, total: 100, fraction: -0.2 })).toBe(0);
    expect(percentOf({ downloaded: 10, total: 300, fraction: 0.033 })).toBe(3);
  });

  it("is undefined without a known total", () => {
    expect(percentOf({ downloaded: 10 })).toBeUndefined();
  });
});

describe("UpdatesSection", () => {
  it("shows the app version readout", async () => {
    render(() => <UpdatesSection />);
    await waitFor(() => expect(screen.getByTestId("updates-version")).toHaveTextContent("0.1.0"));
  });

  it("shows an em dash without a Tauri version", async () => {
    getAppVersionMock.mockResolvedValue(null);
    render(() => <UpdatesSection />);
    await waitFor(() => expect(screen.getByTestId("updates-version")).toHaveTextContent("—"));
  });

  it("runs the manual check and reports up to date", async () => {
    checkForUpdatesMock.mockResolvedValue(null);
    render(() => <UpdatesSection />);
    fireEvent.click(screen.getByTestId("updates-check"));
    expect(screen.getByTestId("updates-check")).toBeDisabled();
    expect(screen.getByTestId("updates-checking")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("updates-result")).toHaveTextContent("You're up to date."),
    );
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("updates-checking")).not.toBeInTheDocument();
  });

  it("shows the update available state with an install button", async () => {
    checkForUpdatesMock.mockResolvedValue(availableUpdate());
    render(() => <UpdatesSection />);
    fireEvent.click(screen.getByTestId("updates-check"));
    await waitFor(() => expect(screen.getByTestId("updates-available")).toBeInTheDocument());
    expect(screen.getByTestId("updates-available")).toHaveTextContent("Update available: v2.0.0");
    expect(screen.getByTestId("updates-install")).toBeEnabled();
  });

  it("surfaces check failures inline", async () => {
    checkForUpdatesMock.mockRejectedValue(new Error("endpoint unreachable"));
    render(() => <UpdatesSection />);
    fireEvent.click(screen.getByTestId("updates-check"));
    await waitFor(() => expect(screen.getByTestId("updates-error")).toBeInTheDocument());
    expect(screen.getByTestId("updates-error")).toHaveTextContent("endpoint unreachable");
  });

  it("re-checks from an available state (no stale result)", async () => {
    checkForUpdatesMock.mockResolvedValueOnce(availableUpdate()).mockResolvedValueOnce(null);
    render(() => <UpdatesSection />);
    fireEvent.click(screen.getByTestId("updates-check"));
    await waitFor(() => expect(screen.getByTestId("updates-available")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("updates-check"));
    await waitFor(() => expect(screen.getByTestId("updates-result")).toBeInTheDocument());
    expect(screen.queryByTestId("updates-available")).not.toBeInTheDocument();
  });

  it("installs with download progress and relaunches", async () => {
    checkForUpdatesMock.mockResolvedValue(availableUpdate());
    let releaseInstall = () => {};
    installAndRelaunchMock.mockImplementation(
      (
        _update: unknown,
        onProgress?: (p: { downloaded: number; total: number; fraction: number }) => void,
      ) => {
        onProgress?.({ downloaded: 30, total: 100, fraction: 0.3 });
        onProgress?.({ downloaded: 80, total: 100, fraction: 0.8 });
        return new Promise<void>((resolve) => {
          releaseInstall = resolve;
        });
      },
    );
    render(() => <UpdatesSection />);
    fireEvent.click(screen.getByTestId("updates-check"));
    await waitFor(() => expect(screen.getByTestId("updates-available")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("updates-install"));
    await waitFor(() =>
      expect(screen.getByTestId("updates-progress-label")).toHaveTextContent("Downloading… 80%"),
    );
    expect(screen.getByTestId("updates-progress")).toHaveStyle("width: 80%");
    expect(installAndRelaunchMock).toHaveBeenCalledWith(
      expect.objectContaining({ version: "2.0.0" }),
      expect.any(Function),
    );
    releaseInstall();
  });

  it("shows byte counts while the total size is unknown", async () => {
    checkForUpdatesMock.mockResolvedValue(availableUpdate());
    let releaseInstall = () => {};
    installAndRelaunchMock.mockImplementation(
      (_update: unknown, onProgress?: (p: { downloaded: number }) => void) => {
        onProgress?.({ downloaded: 4096 });
        return new Promise<void>((resolve) => {
          releaseInstall = resolve;
        });
      },
    );
    render(() => <UpdatesSection />);
    fireEvent.click(screen.getByTestId("updates-check"));
    await waitFor(() => expect(screen.getByTestId("updates-available")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("updates-install"));
    await waitFor(() =>
      expect(screen.getByTestId("updates-progress-label")).toHaveTextContent(
        "Downloading… (4096 bytes)",
      ),
    );
    releaseInstall();
  });

  it("keeps the install state on a failed install", async () => {
    checkForUpdatesMock.mockResolvedValue(availableUpdate());
    installAndRelaunchMock.mockRejectedValue(new Error("install failed"));
    render(() => <UpdatesSection />);
    fireEvent.click(screen.getByTestId("updates-check"));
    await waitFor(() => expect(screen.getByTestId("updates-available")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("updates-install"));
    await waitFor(() =>
      expect(screen.getByTestId("updates-install-error")).toHaveTextContent("install failed"),
    );
    expect(screen.getByTestId("updates-install")).toBeEnabled();
    expect(screen.getByTestId("updates-install")).toHaveTextContent("Install & restart");
  });
});
