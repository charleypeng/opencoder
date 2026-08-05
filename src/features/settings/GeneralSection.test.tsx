// L2 tests for the General settings section (TASK-M9-04): the app
// identity readout, the external links (opener plugin) and the two-step
// Reset settings action that clears every oc-* localStorage key.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import GeneralSection from "./GeneralSection";

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

const GITHUB_URL = "https://github.com/charleypeng/opencoder";

beforeEach(() => {
  getAppVersionMock.mockReset().mockResolvedValue("0.2.0");
  openUrlMock.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("GeneralSection", () => {
  it("renders the app identity, version and links", async () => {
    render(() => <GeneralSection />);

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

  it("shows an em dash for the version outside Tauri", async () => {
    getAppVersionMock.mockResolvedValue(null);
    render(() => <GeneralSection />);

    await waitFor(() => expect(screen.getByTestId("general-version")).toHaveTextContent("—"));
  });

  it("clears only oc-* keys, and only after the confirm step", () => {
    localStorage.setItem("oc-foo", "1");
    localStorage.setItem("oc-lang", "en");
    localStorage.setItem("other-key", "2");
    render(() => <GeneralSection />);

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
