// L2 tests for the General settings section (TASK-M9-04): the app
// identity readout, the external links (opener plugin), the server
// health readout (About content folded in per docs/ui-audit-2026-08
// §7) and the two-step Reset settings action that clears every oc-*
// localStorage key.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import GeneralSection from "./GeneralSection";
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

const SERVER = "srv-general";
const GITHUB_URL = "https://github.com/charleypeng/opencoder";

beforeEach(() => {
  getAppVersionMock.mockReset().mockResolvedValue("0.2.0");
  openUrlMock.mockReset().mockResolvedValue(undefined);
  resetConnections();
  localStorage.clear();
});

afterEach(() => {
  resetConnections();
  localStorage.clear();
});

describe("GeneralSection", () => {
  it("renders the app identity, version and links", async () => {
    render(() => <GeneralSection serverId={SERVER} />);

    expect(screen.getByText("opencoder")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("general-version")).toHaveTextContent("0.2.0"));

    fireEvent.click(screen.getByTestId("general-github"));
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(GITHUB_URL));

    fireEvent.click(screen.getByTestId("general-docs"));
    await waitFor(() =>
      expect(openUrlMock).toHaveBeenCalledWith(`${GITHUB_URL}/blob/main/docs/PLAN.md`),
    );

    fireEvent.click(screen.getByTestId("general-agents"));
    await waitFor(() =>
      expect(openUrlMock).toHaveBeenCalledWith(`${GITHUB_URL}/blob/main/AGENTS.md`),
    );
  });

  it("renders the server version, license link and copyright line", async () => {
    applyServerHealth({
      serverId: SERVER,
      healthy: true,
      version: "1.18.11",
      latencyMs: 4,
      status: "ok",
      failCount: 0,
    });
    render(() => <GeneralSection serverId={SERVER} />);

    await waitFor(() =>
      expect(screen.getByTestId("general-server-version")).toHaveTextContent("1.18.11"),
    );
    expect(screen.getByTestId("general-server-status")).toHaveAttribute("data-status", "ok");
    expect(screen.getByTestId("general-license")).toHaveTextContent("MIT License");

    fireEvent.click(screen.getByTestId("general-license"));
    await waitFor(() =>
      expect(openUrlMock).toHaveBeenCalledWith(`${GITHUB_URL}/blob/main/LICENSE`),
    );

    expect(screen.getByTestId("general-copyright")).toHaveTextContent(
      `Copyright © ${new Date().getFullYear()} charleypeng`,
    );
  });

  it("shows em dashes and an unknown status before any health snapshot / outside Tauri", async () => {
    getAppVersionMock.mockResolvedValue(null);
    render(() => <GeneralSection serverId={SERVER} />);

    await waitFor(() => expect(screen.getByTestId("general-version")).toHaveTextContent("—"));
    expect(screen.getByTestId("general-server-version")).toHaveTextContent("—");
    expect(screen.getByTestId("general-server-status")).toHaveAttribute("data-status", "unknown");
  });

  it("clears only oc-* keys, and only after the confirm step", () => {
    localStorage.setItem("oc-foo", "1");
    localStorage.setItem("oc-lang", "en");
    localStorage.setItem("other-key", "2");
    render(() => <GeneralSection serverId={SERVER} />);

    const reset = screen.getByTestId("general-reset");
    fireEvent.click(reset);
    expect(screen.getByTestId("general-reset")).toHaveTextContent("Click again to confirm");
    expect(localStorage.getItem("oc-foo")).toBe("1");
    expect(localStorage.getItem("oc-lang")).toBe("en");

    fireEvent.click(reset);
    expect(localStorage.getItem("oc-foo")).toBeNull();
    expect(localStorage.getItem("oc-lang")).toBeNull();
    expect(localStorage.getItem("other-key")).toBe("2");
  });
});
