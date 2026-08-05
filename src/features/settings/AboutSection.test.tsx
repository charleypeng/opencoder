// L2 tests for the About settings section (TASK-M9-04): the app version
// readout (getAppVersion), the active server's version / status from the
// connection store, the MIT license and the project links (opener plugin).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import AboutSection from "./AboutSection";
import { applyServerHealth, resetConnections } from "../../stores/connection";

const { getAppVersionMock, openUrlMock } = vi.hoisted(() => ({
  getAppVersionMock: vi.fn(),
  openUrlMock: vi.fn(),
}));

vi.mock("../../services/updates.js", () => ({
  getAppVersion: getAppVersionMock,
  checkForUpdates: vi.fn(async () => null),
  installAndRelaunch: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

const SERVER = "srv-about";
const GITHUB_URL = "https://github.com/charleypeng/opencoder";

beforeEach(() => {
  getAppVersionMock.mockReset().mockResolvedValue("1.0.0");
  openUrlMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  resetConnections();
  localStorage.clear();
});

describe("AboutSection", () => {
  it("renders versions, license, links and the copyright line", async () => {
    applyServerHealth({
      serverId: SERVER,
      healthy: true,
      version: "1.18.11",
      latencyMs: 3,
      status: "ok",
      failCount: 0,
    });
    render(() => <AboutSection serverId={SERVER} />);

    await waitFor(() => expect(screen.getByTestId("about-version")).toHaveTextContent("1.0.0"));
    expect(screen.getByTestId("about-server-version")).toHaveTextContent("1.18.11");
    expect(screen.getByTestId("about-server-status")).toHaveAttribute("data-status", "ok");
    expect(screen.getByTestId("about-license")).toHaveTextContent("MIT License");
    expect(screen.getByTestId("about-copyright")).toHaveTextContent("charleypeng");

    fireEvent.click(screen.getByTestId("about-github"));
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(GITHUB_URL));

    fireEvent.click(screen.getByTestId("about-license"));
    await waitFor(() =>
      expect(openUrlMock).toHaveBeenCalledWith(`${GITHUB_URL}/blob/main/LICENSE`),
    );

    fireEvent.click(screen.getByTestId("about-docs"));
    await waitFor(() =>
      expect(openUrlMock).toHaveBeenCalledWith(`${GITHUB_URL}/blob/main/docs/PLAN.md`),
    );
  });

  it("shows em dashes and an unknown status before any health snapshot / outside Tauri", async () => {
    getAppVersionMock.mockResolvedValue(null);
    render(() => <AboutSection serverId={SERVER} />);

    await waitFor(() => expect(screen.getByTestId("about-version")).toHaveTextContent("—"));
    expect(screen.getByTestId("about-server-version")).toHaveTextContent("—");
    expect(screen.getByTestId("about-server-status")).toHaveAttribute("data-status", "unknown");
  });
});
