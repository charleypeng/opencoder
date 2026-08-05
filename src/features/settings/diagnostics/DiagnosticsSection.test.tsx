// L2 tests for the diagnostics settings section (TASK-M9-07): the
// frontend log console (pre-seeded + live capture, level filter, clear),
// the log-forward toggle (persists the pref and flushes captured entries
// to POST /log — the drain-on-stop path keeps the test free of timers),
// the server version readout with the outdated-server hint, and the saved
// permission rules list (load, confirm-then-delete, failure inline).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import DiagnosticsSection from "./DiagnosticsSection.js";
import { applyServerHealth, resetConnections } from "../../../stores/connection.js";
import { applyServerUpdate, resetServerUpdate } from "../../../stores/serverUpdate.js";
import {
  appendLogEntry,
  clearLogEntries,
  installLogCapture,
  logCapture,
  uninstallLogCapture,
} from "./logCapture.js";
import { stopLogForwarding } from "./logForward.js";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));
vi.mock("../../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-diag";

const SAVED_RULES = {
  data: [
    { id: "saved_rule_001", projectID: "project-mock-1", action: "allow", resource: "bash" },
    { id: "saved_rule_002", projectID: "project-mock-1", action: "deny", resource: "edit:src/x" },
  ],
};

function mockClient() {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const state = JSON.parse(JSON.stringify(SAVED_RULES)) as typeof SAVED_RULES;
  const client = {
    get: vi.fn(async (path: string) => {
      if (path === "/api/permission/saved") return JSON.parse(JSON.stringify(state));
      return undefined;
    }),
    post: vi.fn(async (path: string, options: { body?: unknown } = {}) => {
      calls.push({ method: "POST", path, body: options.body });
      return true;
    }),
    delete: vi.fn(async (path: string) => {
      calls.push({ method: "DELETE", path });
      const id = path.split("/").pop();
      state.data = state.data.filter((rule) => rule.id !== id);
      return undefined;
    }),
  };
  getApiClientMock.mockReturnValue(client);
  return { client, calls, state };
}

let harness: ReturnType<typeof mockClient>;

beforeEach(() => {
  harness = mockClient();
  clearLogEntries();
  logCapture.nextId = 1;
  resetConnections();
  resetServerUpdate(SERVER);
  applyServerHealth({
    serverId: SERVER,
    healthy: true,
    version: "1.18.11",
    status: "ok",
    failCount: 0,
  });
});

afterEach(() => {
  uninstallLogCapture();
  stopLogForwarding();
  clearLogEntries();
  resetConnections();
  resetServerUpdate(SERVER);
  localStorage.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("DiagnosticsSection — log console", () => {
  it("renders pre-seeded entries, filters by level and clears", async () => {
    appendLogEntry("error", "first error", 1000);
    appendLogEntry("warn", "first warning", 2000);
    render(() => <DiagnosticsSection serverId={SERVER} />);

    await waitFor(() => expect(screen.getByText("first error")).toBeInTheDocument());
    expect(screen.getByText("first warning")).toBeInTheDocument();
    expect(screen.getAllByTestId("diag-log-entry").length).toBe(2);

    // Warn filter keeps only warnings.
    fireEvent.click(screen.getByTestId("diag-log-filter-warn"));
    expect(screen.getByText("first warning")).toBeInTheDocument();
    expect(screen.queryByText("first error")).not.toBeInTheDocument();

    // Error filter keeps only errors.
    fireEvent.click(screen.getByTestId("diag-log-filter-error"));
    expect(screen.getByText("first error")).toBeInTheDocument();
    expect(screen.queryByText("first warning")).not.toBeInTheDocument();

    // All restores both.
    fireEvent.click(screen.getByTestId("diag-log-filter-all"));
    expect(screen.getByText("first error")).toBeInTheDocument();
    expect(screen.getByText("first warning")).toBeInTheDocument();

    // Clear empties the console (both the ring and the view).
    fireEvent.click(screen.getByTestId("diag-log-clear"));
    expect(screen.getByTestId("diag-log-empty")).toBeInTheDocument();
    expect(logCapture.entries.length).toBe(0);
  });

  it("shows the empty state and picks up live capture events", async () => {
    render(() => <DiagnosticsSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("diag-log-empty")).toBeInTheDocument());

    appendLogEntry("error", "live error");
    await waitFor(() => expect(screen.getByText("live error")).toBeInTheDocument());
  });
});

describe("DiagnosticsSection — log forwarding", () => {
  it("forwards captured errors to POST /log when enabled (drain on stop)", async () => {
    const stopCapture = installLogCapture();
    render(() => <DiagnosticsSection serverId={SERVER} />);
    const toggle = await screen.findByTestId("diag-forward-toggle");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(JSON.parse(localStorage.getItem("oc-diagnostics") ?? "{}")).toEqual({
      forwardLogs: true,
    });

    console.error("forwarded error");
    expect(harness.calls.length).toBe(0);

    // Toggling off drains the queue: the captured entry is sent.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await waitFor(() => expect(harness.calls.length).toBe(1));
    expect(harness.calls[0]).toEqual({
      method: "POST",
      path: "/log",
      body: { service: "opencoder-webview", level: "error", message: "forwarded error" },
    });
    stopCapture();
  });

  it("does not forward anything while disabled", async () => {
    const stopCapture = installLogCapture();
    render(() => <DiagnosticsSection serverId={SERVER} />);
    await screen.findByTestId("diag-forward-toggle");
    console.error("not forwarded");
    expect(harness.calls.length).toBe(0);
    stopCapture();
  });
});

describe("DiagnosticsSection — server version", () => {
  it("shows the running version and the up-to-date note", async () => {
    render(() => <DiagnosticsSection serverId={SERVER} />);
    await waitFor(() =>
      expect(screen.getByTestId("diag-server-version")).toHaveTextContent("1.18.11"),
    );
    expect(screen.queryByTestId("diag-server-update")).not.toBeInTheDocument();
  });

  it("shows the outdated-server hint from the update store", async () => {
    applyServerUpdate(SERVER, { version: "1.19.0", current: "1.18.11" });
    render(() => <DiagnosticsSection serverId={SERVER} />);
    await waitFor(() =>
      expect(screen.getByTestId("diag-server-update")).toHaveTextContent("1.19.0"),
    );
    expect(screen.getByTestId("diag-server-update")).toHaveTextContent("1.18.11");
  });
});

describe("DiagnosticsSection — saved permission rules", () => {
  it("lists the saved rules with action, resource and project", async () => {
    render(() => <DiagnosticsSection serverId={SERVER} />);
    await waitFor(() =>
      expect(screen.getByTestId("diag-rule-action-saved_rule_001")).toHaveTextContent("allow"),
    );
    expect(screen.getByTestId("diag-rule-resource-saved_rule_001")).toHaveTextContent("bash");
    expect(screen.getAllByText("project-mock-1").length).toBe(2);
    expect(screen.getByTestId("diag-rule-resource-saved_rule_002")).toHaveTextContent("edit:src/x");
  });

  it("shows the empty state when no rules are saved", async () => {
    harness.client.get.mockResolvedValue({ data: [] });
    render(() => <DiagnosticsSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("diag-rules-empty")).toBeInTheDocument());
  });

  it("deletes a rule after a confirm click and removes it from the list", async () => {
    render(() => <DiagnosticsSection serverId={SERVER} />);
    await waitFor(() =>
      expect(screen.getByTestId("diag-rule-delete-saved_rule_001")).toBeInTheDocument(),
    );

    // First click arms the confirmation (nothing is deleted yet).
    fireEvent.click(screen.getByTestId("diag-rule-delete-saved_rule_001"));
    expect(harness.calls.some((call) => call.method === "DELETE")).toBe(false);

    // Second click deletes via DELETE /api/permission/saved/{id}.
    fireEvent.click(screen.getByTestId("diag-rule-delete-saved_rule_001"));
    await waitFor(() => expect(harness.calls.some((call) => call.method === "DELETE")).toBe(true));
    await waitFor(() =>
      expect(screen.queryByTestId("diag-rule-delete-saved_rule_001")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("diag-rule-resource-saved_rule_002")).toBeInTheDocument();
  });

  it("shows an inline error when the delete fails", async () => {
    harness.client.delete.mockRejectedValue(new Error("server refused"));
    render(() => <DiagnosticsSection serverId={SERVER} />);
    await waitFor(() =>
      expect(screen.getByTestId("diag-rule-delete-saved_rule_001")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("diag-rule-delete-saved_rule_001"));
    fireEvent.click(screen.getByTestId("diag-rule-delete-saved_rule_001"));
    await waitFor(() => expect(screen.getByTestId("diag-rule-error")).toBeInTheDocument());
    // The failed rule stays in the list.
    expect(screen.getByTestId("diag-rule-delete-saved_rule_001")).toBeInTheDocument();
  });

  it("shows a load error when the rules cannot be fetched", async () => {
    harness.client.get.mockRejectedValue(new Error("unreachable"));
    render(() => <DiagnosticsSection serverId={SERVER} />);
    await waitFor(() => expect(screen.getByTestId("diag-rules-error")).toBeInTheDocument());
    expect(screen.getByTestId("diag-rules-error")).toHaveTextContent("unreachable");
  });
});
