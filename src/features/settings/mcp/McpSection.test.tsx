// L2 tests for the MCP settings section (TASK-M9-06): the status cards
// (connected / failed + expandable error / disabled / needs_auth /
// needs_client_registration), connect / disconnect with the global
// in-flight lock and inline failures, the Add dialog (local tab: command
// line → command array + env rows; remote tab: url + header rows; POST
// body shape; validation; failure retention), the Authorize flow through
// McpOAuthDialog (auth start → browser open → auto poll to connected;
// code completion; cancel stops polling), the mcp.tools.changed event
// refresh (the mcp store version bump refetches GET /mcp) and the load
// failure + retry path. The HTTP layer runs through the mocked Tauri
// invoke client with in-memory MCP state mirroring the mock server's
// transitions.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import McpSection, { commandArray, rowsToRecord } from "./McpSection.js";
import type { McpStatusMap } from "../../../services/mcp.js";
import { clearToasts, toasts } from "../../../stores/toasts.js";
import { bumpMcpVersion, resetServer as resetMcp } from "../../../stores/mcp.js";

const { getApiClientMock, openUrlMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  openUrlMock: vi.fn(),
}));

vi.mock("../../../services/client.js", () => ({ getApiClient: getApiClientMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

const SERVER = "srv-mcp";

const FIXTURE: McpStatusMap = {
  filesystem: { status: "connected" },
  fetch: { status: "failed", error: "spawn ENOENT: command not found" },
  legacy: { status: "disabled" },
  github: { status: "needs_auth" },
  "oauth-pending": { status: "needs_client_registration", error: "client registration missing" },
};

type JsonRecord = Record<string, unknown>;

function mockClient() {
  const state: JsonRecord = JSON.parse(JSON.stringify(FIXTURE));
  const client = {
    // Fresh response bodies per call, like the real server (the section's
    // signals rely on reference changes to notify).
    get: vi.fn(async (path: string) => {
      if (path === "/mcp") return JSON.parse(JSON.stringify(state));
      return undefined;
    }),
    post: vi.fn<(path: string, options?: { body?: unknown }) => Promise<unknown>>(
      async (path: string) => {
        if (path === "/mcp") return JSON.parse(JSON.stringify(state));
        if (path.endsWith("/connect")) {
          const name = path.slice(5, -"/connect".length);
          state[name] = { status: "connected" };
          return true;
        }
        if (path.endsWith("/disconnect")) {
          const name = path.slice(5, -"/disconnect".length);
          state[name] = { status: "disabled" };
          return true;
        }
        return false;
      },
    ),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return { client, state };
}

let harness: ReturnType<typeof mockClient>;

function setup() {
  harness = mockClient();
  return harness;
}

beforeEach(() => {
  getApiClientMock.mockReset();
  openUrlMock.mockReset();
  openUrlMock.mockResolvedValue(undefined);
  vi.useRealTimers();
  resetMcp(SERVER);
});

afterEach(() => {
  vi.useRealTimers();
  resetMcp(SERVER);
  clearToasts();
  vi.clearAllMocks();
});

describe("commandArray / rowsToRecord (pure helpers)", () => {
  it("splits a command line into the contract's command array", () => {
    expect(commandArray("npx -y @modelcontextprotocol/server-filesystem")).toEqual([
      "npx",
      "-y",
      "@modelcontextprotocol/server-filesystem",
    ]);
    expect(commandArray("  ls   -la  ")).toEqual(["ls", "-la"]);
    expect(commandArray("")).toEqual([]);
  });

  it("collapses key/value rows into a record, dropping empty keys", () => {
    expect(
      rowsToRecord([
        { key: "API_KEY", value: "secret" },
        { key: "", value: "ignored" },
        { key: "EMPTY_VAL", value: "" },
      ]),
    ).toEqual({ API_KEY: "secret", EMPTY_VAL: "" });
    expect(rowsToRecord([{ key: "", value: "" }])).toEqual({});
  });
});

describe("McpSection — status cards", () => {
  it("renders every status card with its badge and sorted names", async () => {
    setup();
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-fetch");
    const names = screen.getAllByTestId(/^mcp-server-/).map((el) => el.getAttribute("data-testid"));
    expect(names).toEqual([
      "mcp-server-fetch",
      "mcp-server-filesystem",
      "mcp-server-github",
      "mcp-server-legacy",
      "mcp-server-oauth-pending",
    ]);

    expect(screen.getByTestId("mcp-status-filesystem")).toHaveTextContent("Connected");
    expect(screen.getByTestId("mcp-status-fetch")).toHaveTextContent("Failed");
    expect(screen.getByTestId("mcp-status-legacy")).toHaveTextContent("Disabled");
    expect(screen.getByTestId("mcp-status-github")).toHaveTextContent("Needs authorization");
    expect(screen.getByTestId("mcp-status-oauth-pending")).toHaveTextContent(
      "Needs client registration",
    );
  });

  it("renders the connected / failed / disabled action buttons", async () => {
    setup();
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-filesystem");
    expect(screen.getByTestId("mcp-disconnect-filesystem")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-connect-fetch")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-connect-legacy")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-authorize-github")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-connect-oauth-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-connect-filesystem")).not.toBeInTheDocument();
  });

  it("expands and hides the failed server's error detail", async () => {
    setup();
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-fetch");
    expect(screen.queryByTestId("mcp-error-fetch")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mcp-error-toggle-fetch"));
    expect(screen.getByTestId("mcp-error-fetch")).toHaveTextContent(
      "spawn ENOENT: command not found",
    );

    fireEvent.click(screen.getByTestId("mcp-error-toggle-fetch"));
    expect(screen.queryByTestId("mcp-error-fetch")).not.toBeInTheDocument();
  });

  it("shows an empty state when no servers are configured", async () => {
    setup();
    harness.client.get.mockResolvedValue({});
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-empty");
  });

  it("shows the load error with a working retry", async () => {
    setup();
    harness.client.get.mockRejectedValueOnce(new Error("boom"));
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-load-error");
    expect(screen.getByTestId("mcp-load-error")).toHaveTextContent(
      "Could not load the MCP servers: boom",
    );

    fireEvent.click(screen.getByTestId("mcp-retry"));
    await screen.findByTestId("mcp-server-filesystem");
    expect(screen.queryByTestId("mcp-load-error")).not.toBeInTheDocument();
  });
});

describe("McpSection — connect / disconnect", () => {
  it("connects a disabled server and refreshes the card", async () => {
    const { client } = setup();
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-legacy");
    const getsBefore = client.get.mock.calls.length;

    fireEvent.click(screen.getByTestId("mcp-connect-legacy"));
    await waitFor(() =>
      expect(screen.getByTestId("mcp-status-legacy")).toHaveTextContent("Connected"),
    );

    expect(client.post).toHaveBeenCalledWith("/mcp/legacy/connect", undefined);
    expect(client.get.mock.calls.length).toBeGreaterThan(getsBefore);
    expect(screen.getByTestId("mcp-disconnect-legacy")).toBeInTheDocument();
  });

  it("disconnects a connected server and refreshes the card", async () => {
    const { client } = setup();
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-filesystem");
    fireEvent.click(screen.getByTestId("mcp-disconnect-filesystem"));
    await waitFor(() =>
      expect(screen.getByTestId("mcp-status-filesystem")).toHaveTextContent("Disabled"),
    );

    expect(client.post).toHaveBeenCalledWith("/mcp/filesystem/disconnect", undefined);
    expect(screen.getByTestId("mcp-connect-filesystem")).toBeInTheDocument();
  });

  it("locks every row's actions while a mutation is in flight", async () => {
    const { state } = setup();
    let resolveConnect: ((value: unknown) => void) | undefined;
    harness.client.post.mockImplementation((path: string) => {
      if (path === "/mcp/legacy/connect") {
        return new Promise((resolve) => {
          resolveConnect = (value: unknown) => {
            state["legacy"] = { status: "connected" };
            resolve(value);
          };
        });
      }
      return Promise.resolve(false);
    });
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-legacy");
    fireEvent.click(screen.getByTestId("mcp-connect-legacy"));

    const connectButton = screen.getByTestId("mcp-connect-legacy") as HTMLButtonElement;
    await waitFor(() => expect(connectButton.disabled).toBe(true));
    expect(connectButton).toHaveTextContent("Connecting…");
    // The global lock disables every other row's action too.
    expect((screen.getByTestId("mcp-disconnect-filesystem") as HTMLButtonElement).disabled).toBe(
      true,
    );

    resolveConnect?.(true);
    await waitFor(() =>
      expect(screen.getByTestId("mcp-status-legacy")).toHaveTextContent("Connected"),
    );
  });

  it("shows an inline failure and keeps the previous state", async () => {
    setup();
    harness.client.post.mockRejectedValueOnce(new Error("connect boom"));
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-legacy");
    fireEvent.click(screen.getByTestId("mcp-connect-legacy"));
    await waitFor(() =>
      expect(screen.getByTestId("mcp-action-error-legacy")).toHaveTextContent(
        "Could not connect legacy: connect boom",
      ),
    );

    expect(screen.getByTestId("mcp-status-legacy")).toHaveTextContent("Disabled");
    expect(screen.getByTestId("mcp-connect-legacy")).toBeInTheDocument();
  });

  it("shows an inline failure for a failed disconnect", async () => {
    setup();
    harness.client.post.mockRejectedValueOnce(new Error("disconnect boom"));
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-filesystem");
    fireEvent.click(screen.getByTestId("mcp-disconnect-filesystem"));
    await waitFor(() =>
      expect(screen.getByTestId("mcp-action-error-filesystem")).toHaveTextContent(
        "Could not disconnect filesystem: disconnect boom",
      ),
    );
    expect(screen.getByTestId("mcp-status-filesystem")).toHaveTextContent("Connected");
  });
});

describe("McpSection — add dialog", () => {
  it("adds a local server: command line → command array + env rows", async () => {
    const { client } = setup();
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-filesystem");
    fireEvent.click(screen.getByTestId("mcp-add"));
    await screen.findByTestId("mcp-add-dialog");

    expect(screen.getByTestId("mcp-add-tab-local")).toHaveAttribute("aria-pressed", "true");
    fireEvent.input(screen.getByTestId("mcp-add-name"), {
      target: { value: "notes" },
    });
    fireEvent.input(screen.getByTestId("mcp-add-command"), {
      target: { value: "npx -y @modelcontextprotocol/server-notes" },
    });
    fireEvent.input(screen.getByTestId("mcp-env-key-0"), { target: { value: "API_KEY" } });
    fireEvent.input(screen.getByTestId("mcp-env-value-0"), { target: { value: "secret" } });
    fireEvent.click(screen.getByTestId("mcp-env-add"));
    fireEvent.input(screen.getByTestId("mcp-env-key-1"), { target: { value: "EMPTY_VAL" } });
    fireEvent.input(screen.getByTestId("mcp-env-value-1"), { target: { value: "" } });

    fireEvent.click(screen.getByTestId("mcp-add-submit"));
    await waitFor(() => expect(screen.queryByTestId("mcp-add-dialog")).not.toBeInTheDocument());

    expect(client.post).toHaveBeenCalledWith("/mcp", {
      body: {
        name: "notes",
        config: {
          type: "local",
          command: ["npx", "-y", "@modelcontextprotocol/server-notes"],
          environment: { API_KEY: "secret", EMPTY_VAL: "" },
        },
      },
    });
    // The POST response is applied directly (no extra refetch).
    expect(client.get.mock.calls.length).toBe(1);
    await waitFor(() =>
      expect(toasts.some((toast) => toast.message === "MCP server added")).toBe(true),
    );
  });

  it("adds a remote server: url + header rows", async () => {
    const { client } = setup();
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-filesystem");
    fireEvent.click(screen.getByTestId("mcp-add"));
    await screen.findByTestId("mcp-add-dialog");

    fireEvent.click(screen.getByTestId("mcp-add-tab-remote"));
    expect(screen.getByTestId("mcp-add-tab-remote")).toHaveAttribute("aria-pressed", "true");
    fireEvent.input(screen.getByTestId("mcp-add-name"), {
      target: { value: "remote-llm" },
    });
    fireEvent.input(screen.getByTestId("mcp-add-url"), {
      target: { value: "https://mcp.example.com/sse" },
    });
    fireEvent.input(screen.getByTestId("mcp-header-key-0"), { target: { value: "X-Key" } });
    fireEvent.input(screen.getByTestId("mcp-header-value-0"), { target: { value: "v1" } });
    fireEvent.click(screen.getByTestId("mcp-header-add"));
    fireEvent.input(screen.getByTestId("mcp-header-key-1"), { target: { value: "Empty" } });
    fireEvent.input(screen.getByTestId("mcp-header-value-1"), { target: { value: "" } });

    fireEvent.click(screen.getByTestId("mcp-add-submit"));
    await waitFor(() => expect(screen.queryByTestId("mcp-add-dialog")).not.toBeInTheDocument());

    expect(client.post).toHaveBeenCalledWith("/mcp", {
      body: {
        name: "remote-llm",
        config: {
          type: "remote",
          url: "https://mcp.example.com/sse",
          headers: { "X-Key": "v1", Empty: "" },
        },
      },
    });
  });

  it("validates required fields before enabling the submit button", async () => {
    setup();
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-filesystem");
    fireEvent.click(screen.getByTestId("mcp-add"));
    await screen.findByTestId("mcp-add-dialog");

    const submit = screen.getByTestId("mcp-add-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.input(screen.getByTestId("mcp-add-name"), { target: { value: "x" } });
    expect(submit.disabled).toBe(true);

    fireEvent.input(screen.getByTestId("mcp-add-command"), { target: { value: "npx" } });
    expect(submit.disabled).toBe(false);

    // The remote tab requires the url instead of the command.
    fireEvent.click(screen.getByTestId("mcp-add-tab-remote"));
    expect(submit.disabled).toBe(true);
    fireEvent.input(screen.getByTestId("mcp-add-url"), { target: { value: "https://x.example" } });
    expect(submit.disabled).toBe(false);
  });

  it("removes env and header rows", async () => {
    setup();
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-filesystem");
    fireEvent.click(screen.getByTestId("mcp-add"));
    await screen.findByTestId("mcp-add-dialog");

    fireEvent.click(screen.getByTestId("mcp-env-add"));
    expect(screen.getByTestId("mcp-env-key-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mcp-env-remove-1"));
    expect(screen.queryByTestId("mcp-env-key-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("mcp-env-key-0")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mcp-add-tab-remote"));
    fireEvent.click(screen.getByTestId("mcp-header-add"));
    fireEvent.click(screen.getByTestId("mcp-header-remove-1"));
    expect(screen.queryByTestId("mcp-header-key-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("mcp-header-key-0")).toBeInTheDocument();
  });

  it("keeps the dialog open with an inline error when the add fails", async () => {
    setup();
    harness.client.post.mockRejectedValueOnce(new Error("add boom"));
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-filesystem");
    fireEvent.click(screen.getByTestId("mcp-add"));
    await screen.findByTestId("mcp-add-dialog");

    fireEvent.input(screen.getByTestId("mcp-add-name"), { target: { value: "notes" } });
    fireEvent.input(screen.getByTestId("mcp-add-command"), { target: { value: "npx" } });
    fireEvent.click(screen.getByTestId("mcp-add-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("mcp-add-error")).toHaveTextContent(
        "Could not add the server: add boom",
      ),
    );

    expect(screen.getByTestId("mcp-add-dialog")).toBeInTheDocument();
  });
});

describe("McpSection — OAuth flow", () => {
  it("authorizes: starts the flow, opens the browser and polls to connected", async () => {
    vi.useFakeTimers();
    const { client } = setup();
    client.post.mockImplementation(async (path: string) => {
      if (path === "/mcp/github/auth") {
        return { authorizationUrl: "https://idp.example/auth?state=st1", oauthState: "st1" };
      }
      if (path === "/mcp/github/auth/authenticate") {
        return { status: "needs_auth" };
      }
      return false;
    });
    render(() => <McpSection serverId={SERVER} />);

    await vi.advanceTimersByTimeAsync(0);
    await screen.findByTestId("mcp-server-github");
    fireEvent.click(screen.getByTestId("mcp-authorize-github"));
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(client.post).toHaveBeenCalledWith("/mcp/github/auth", undefined);
    expect(openUrlMock).toHaveBeenCalledWith("https://idp.example/auth?state=st1");
    expect(screen.getByTestId("mcp-oauth-waiting")).toBeInTheDocument();
    expect(client.post).toHaveBeenCalledWith("/mcp/github/auth/authenticate", {
      query: { poll: true },
    });

    // The mock server flips the server to connected on the first poll —
    // refresh the list and close the dialog.
    client.post.mockImplementation(async (path: string) => {
      if (path === "/mcp/github/auth/authenticate") {
        return { status: "connected" };
      }
      return false;
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    expect(screen.queryByTestId("mcp-oauth-dialog")).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(client.get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("authorize: a code submission completes the flow via the callback", async () => {
    vi.useFakeTimers();
    const { client } = setup();
    client.post.mockImplementation(async (path: string) => {
      if (path === "/mcp/github/auth") {
        return { authorizationUrl: "https://idp.example/auth?state=st1", oauthState: "st1" };
      }
      if (path === "/mcp/github/auth/authenticate") {
        return { status: "needs_auth" };
      }
      return false;
    });
    render(() => <McpSection serverId={SERVER} />);

    await vi.advanceTimersByTimeAsync(0);
    await screen.findByTestId("mcp-server-github");
    fireEvent.click(screen.getByTestId("mcp-authorize-github"));
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    client.post.mockImplementation(async (path: string) => {
      if (path === "/mcp/github/auth/callback") {
        return { status: "connected" };
      }
      return false;
    });

    fireEvent.input(screen.getByTestId("mcp-oauth-code-input"), {
      target: { value: "mock-oauth-code" },
    });
    fireEvent.click(screen.getByTestId("mcp-oauth-code-submit"));
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(client.post).toHaveBeenCalledWith("/mcp/github/auth/callback", {
      body: { code: "mock-oauth-code" },
    });
    expect(screen.queryByTestId("mcp-oauth-dialog")).not.toBeInTheDocument();
    // The code submission aborted the auto poll.
    expect(client.post.mock.calls.filter(([path]) => path.endsWith("/authenticate")).length).toBe(
      1,
    );
  });

  it("authorize: cancel closes the dialog and stops the polling", async () => {
    vi.useFakeTimers();
    const { client } = setup();
    client.post.mockImplementation(async (path: string) => {
      if (path === "/mcp/github/auth") {
        return { authorizationUrl: "https://idp.example/auth?state=st1", oauthState: "st1" };
      }
      if (path === "/mcp/github/auth/authenticate") {
        return { status: "needs_auth" };
      }
      return false;
    });
    render(() => <McpSection serverId={SERVER} />);

    await vi.advanceTimersByTimeAsync(0);
    await screen.findByTestId("mcp-server-github");
    fireEvent.click(screen.getByTestId("mcp-authorize-github"));
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    const callsBeforeCancel = client.post.mock.calls.length;

    fireEvent.click(screen.getByTestId("mcp-oauth-cancel"));
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();

    expect(screen.queryByTestId("mcp-oauth-dialog")).not.toBeInTheDocument();
    expect(client.post.mock.calls.length).toBe(callsBeforeCancel);
  });

  it("authorize: a failing auth start surfaces the inline error", async () => {
    vi.useFakeTimers();
    const { client } = setup();
    client.post.mockRejectedValueOnce(new Error("boom"));
    render(() => <McpSection serverId={SERVER} />);

    await vi.advanceTimersByTimeAsync(0);
    await screen.findByTestId("mcp-server-github");
    fireEvent.click(screen.getByTestId("mcp-authorize-github"));
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(screen.getByTestId("mcp-oauth-error")).toHaveTextContent(
      "Failed to start the OAuth authorization.",
    );
    expect(screen.getByTestId("mcp-oauth-dialog")).toBeInTheDocument();
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});

describe("McpSection — mcp.tools.changed refresh", () => {
  it("refetches the status list when the mcp store version bumps", async () => {
    const { client } = setup();
    render(() => <McpSection serverId={SERVER} />);

    await screen.findByTestId("mcp-server-filesystem");
    const getsBefore = client.get.mock.calls.length;

    bumpMcpVersion(SERVER);
    await waitFor(() => expect(client.get.mock.calls.length).toBeGreaterThan(getsBefore));

    // The refreshed list is rendered.
    bumpMcpVersion(SERVER);
    await waitFor(() =>
      expect(client.get.mock.calls.length).toBeGreaterThanOrEqual(getsBefore + 2),
    );
  });
});

/** Flushes pending promise microtasks (no timers involved). */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
