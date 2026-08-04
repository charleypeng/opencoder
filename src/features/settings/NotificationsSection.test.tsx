// L2 tests for the notifications settings section (TASK-M8-06): the
// do-not-disturb master switch, the per-server toggles and their
// localStorage persistence (the switches mirror the stored prefs —
// absent fields mean ON).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import NotificationsSection from "./NotificationsSection.js";
import type { ServerEntry } from "../../services/servers.js";

const { listServersMock } = vi.hoisted(() => ({ listServersMock: vi.fn() }));
vi.mock("../../services/servers.js", () => ({ listServers: listServersMock }));

function server(id: string, name: string): ServerEntry {
  return {
    id,
    name,
    url: `http://${id}.local:4096`,
    createdAt: 1,
  };
}

beforeEach(() => {
  localStorage.clear();
  listServersMock.mockReset();
  listServersMock.mockResolvedValue([server("srv-a", "Alpha"), server("srv-b", "Beta")]);
});

afterEach(() => {
  localStorage.clear();
});

describe("NotificationsSection", () => {
  it("renders the master switch on by default with per-server toggles", async () => {
    render(() => <NotificationsSection />);
    expect(screen.getByTestId("notifications-master")).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(screen.getByTestId("notifications-server-srv-a")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("notifications-server-srv-b")).toBeInTheDocument();
    expect(screen.getByTestId("notifications-server-srv-a-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("toggles the master switch off and persists", async () => {
    render(() => <NotificationsSection />);
    fireEvent.click(screen.getByTestId("notifications-master"));
    expect(screen.getByTestId("notifications-master")).toHaveAttribute("aria-checked", "false");
    expect(JSON.parse(localStorage.getItem("oc-notifications") ?? "{}").enabled).toBe(false);
  });

  it("toggles one server off and persists, leaving the others on", async () => {
    render(() => <NotificationsSection />);
    await waitFor(() =>
      expect(screen.getByTestId("notifications-server-srv-a")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("notifications-server-srv-a-toggle"));
    expect(screen.getByTestId("notifications-server-srv-a-toggle")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByTestId("notifications-server-srv-b-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(JSON.parse(localStorage.getItem("oc-notifications") ?? "{}").perServer).toEqual({
      "srv-a": false,
    });
  });

  it("reflects persisted prefs at mount", async () => {
    localStorage.setItem(
      "oc-notifications",
      JSON.stringify({ enabled: false, perServer: { "srv-a": false, "srv-b": true } }),
    );
    render(() => <NotificationsSection />);
    expect(screen.getByTestId("notifications-master")).toHaveAttribute("aria-checked", "false");
    await waitFor(() =>
      expect(screen.getByTestId("notifications-server-srv-a-toggle")).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
    expect(screen.getByTestId("notifications-server-srv-b-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("keeps the master switch when the server list fails to load", async () => {
    listServersMock.mockRejectedValue(new Error("registry unavailable"));
    render(() => <NotificationsSection />);
    expect(screen.getByTestId("notifications-master")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("notifications-server-srv-a")).not.toBeInTheDocument();
  });
});
