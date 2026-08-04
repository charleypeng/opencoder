// L2 tests for the Add Server wizard (TASK-M1-05): form rendering, URL
// normalization, the probe flow, the save flow and the plain-HTTP warning.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import AddServer from "./AddServer";
import { isRemotePlainHttp, normalizeServerUrl } from "./url";
import type { ServerEntry } from "../../services/servers";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function typeUrl(value: string): void {
  fireEvent.input(screen.getByTestId("url-input"), { target: { value } });
}

describe("normalizeServerUrl", () => {
  it("prepends http:// when no scheme is present", () => {
    expect(normalizeServerUrl("localhost:14096")).toBe("http://localhost:14096");
    expect(normalizeServerUrl("example.com:8080/path")).toBe("http://example.com:8080/path");
  });

  it("keeps an existing scheme and strips trailing slashes", () => {
    expect(normalizeServerUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeServerUrl("http://example.com:8080/path///")).toBe(
      "http://example.com:8080/path",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeServerUrl("  localhost:14096  ")).toBe("http://localhost:14096");
  });

  it("rejects empty, invalid and non-http URLs", () => {
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("   ")).toBeNull();
    expect(normalizeServerUrl("not a url")).toBeNull();
    expect(normalizeServerUrl("ftp://example.com")).toBeNull();
  });
});

describe("isRemotePlainHttp", () => {
  it("flags plain HTTP on remote hosts", () => {
    expect(isRemotePlainHttp("http://192.168.1.5:14096")).toBe(true);
    expect(isRemotePlainHttp("http://example.com")).toBe(true);
  });

  it("does not flag loopback hosts or HTTPS", () => {
    expect(isRemotePlainHttp("http://localhost:14096")).toBe(false);
    expect(isRemotePlainHttp("http://127.0.0.1:14096")).toBe(false);
    expect(isRemotePlainHttp("https://example.com")).toBe(false);
  });
});

describe("AddServer form", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders all form fields and actions", () => {
    render(() => <AddServer />);
    expect(screen.getByText("Add server")).toBeInTheDocument();
    expect(screen.getByTestId("name-input")).toBeInTheDocument();
    expect(screen.getByTestId("url-input")).toBeInTheDocument();
    expect(screen.getByTestId("username-input")).toBeInTheDocument();
    expect(screen.getByTestId("password-input")).toBeInTheDocument();
    expect(screen.getByTestId("test-connection")).toBeDisabled();
    expect(screen.getByTestId("save-server")).toBeDisabled();
  });

  it("enables actions once name and url are valid", () => {
    render(() => <AddServer />);
    fireEvent.input(screen.getByTestId("name-input"), { target: { value: "Local" } });
    expect(screen.getByTestId("save-server")).toBeDisabled();
    typeUrl("localhost:14096");
    expect(screen.getByTestId("test-connection")).toBeEnabled();
    expect(screen.getByTestId("save-server")).toBeEnabled();
  });

  it("toggles password visibility", () => {
    render(() => <AddServer />);
    const input = screen.getByTestId("password-input");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByTestId("password-toggle"));
    expect(input).toHaveAttribute("type", "text");
  });

  it("shows the plain-HTTP warning only for remote http URLs", async () => {
    render(() => <AddServer />);
    expect(screen.queryByTestId("plain-http-warning")).toBeNull();

    typeUrl("http://192.168.1.5:14096");
    await waitFor(() => expect(screen.getByTestId("plain-http-warning")).toBeInTheDocument());

    typeUrl("https://192.168.1.5:14096");
    await waitFor(() => expect(screen.queryByTestId("plain-http-warning")).toBeNull());

    typeUrl("http://localhost:14096");
    await waitFor(() => expect(screen.queryByTestId("plain-http-warning")).toBeNull());
  });
});

describe("AddServer probe flow", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows version and latency on a successful probe", async () => {
    invokeMock.mockResolvedValue({
      serverId: "probe",
      healthy: true,
      version: "1.18.11-mock",
      latencyMs: 12,
      failCount: 0,
      status: "ok",
    });
    render(() => <AddServer />);
    typeUrl("localhost:14096");
    fireEvent.click(screen.getByTestId("test-connection"));

    await waitFor(() => {
      expect(screen.getByTestId("probe-success")).toHaveTextContent("version 1.18.11-mock · 12 ms");
    });
    expect(invokeMock).toHaveBeenCalledWith("probe_server", {
      url: "http://localhost:14096",
    });
  });

  it("shows a generic failure when the probe resolves unhealthy", async () => {
    invokeMock.mockResolvedValue({
      serverId: "probe",
      healthy: false,
      failCount: 1,
      status: "down",
    });
    render(() => <AddServer />);
    typeUrl("http://192.168.1.5:14096");
    fireEvent.click(screen.getByTestId("test-connection"));

    await waitFor(() => {
      expect(screen.getByTestId("probe-failure")).toHaveTextContent("Could not connect");
    });
  });

  it("shows the ApiError message when the probe rejects", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));
    render(() => <AddServer />);
    typeUrl("localhost:14096");
    fireEvent.click(screen.getByTestId("test-connection"));

    await waitFor(() => {
      expect(screen.getByTestId("probe-failure")).toHaveTextContent("boom");
    });
  });

  it("passes credentials along when provided", async () => {
    invokeMock.mockResolvedValue({
      serverId: "probe",
      healthy: true,
      version: "1.0",
      latencyMs: 5,
      failCount: 0,
      status: "ok",
    });
    render(() => <AddServer />);
    typeUrl("http://192.168.1.5:14096");
    fireEvent.input(screen.getByTestId("username-input"), { target: { value: "admin" } });
    fireEvent.input(screen.getByTestId("password-input"), { target: { value: "pw" } });
    fireEvent.click(screen.getByTestId("test-connection"));

    await waitFor(() => expect(screen.getByTestId("probe-success")).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith("probe_server", {
      url: "http://192.168.1.5:14096",
      auth: { username: "admin", password: "pw" },
    });
  });
});

describe("AddServer save flow", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("saves with the normalized url, emits the entry and resets the form", async () => {
    const saved: ServerEntry = {
      id: "srv-1",
      name: "Local",
      url: "http://localhost:14096",
      createdAt: 123,
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "add_server") return Promise.resolve({ ...saved, password: "secret" });
      return Promise.reject(new Error(`unexpected command ${cmd}`));
    });
    const onAdded = vi.fn();
    render(() => <AddServer onAdded={onAdded} />);
    fireEvent.input(screen.getByTestId("name-input"), { target: { value: "Local" } });
    typeUrl("localhost:14096/");
    fireEvent.click(screen.getByTestId("save-server"));

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("add_server", {
      entry: { name: "Local", url: "http://localhost:14096" },
    });
    // The password is stripped from the emitted entry.
    expect(onAdded).toHaveBeenCalledWith(saved);
    expect(screen.getByTestId("name-input")).toHaveValue("");
    expect(screen.getByTestId("url-input")).toHaveValue("");
  });

  it("shows an inline error when the save fails", async () => {
    invokeMock.mockRejectedValue({
      status: 500,
      code: "persist",
      message: "store failed",
      retriable: false,
    });
    render(() => <AddServer />);
    fireEvent.input(screen.getByTestId("name-input"), { target: { value: "Local" } });
    typeUrl("localhost:14096");
    fireEvent.click(screen.getByTestId("save-server"));

    await waitFor(() => {
      expect(screen.getByTestId("save-error")).toHaveTextContent("store failed");
    });
  });
});

describe("AddServer edit mode", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const editEntry: ServerEntry = {
    id: "srv-1",
    name: "Local",
    url: "http://localhost:14096",
    username: "admin",
    password: "secret",
    createdAt: 123,
  };

  it("pre-fills the form and saves via update_server, keeping the stored password", async () => {
    const onAdded = vi.fn();
    render(() => <AddServer server={editEntry} onAdded={onAdded} />);
    expect(screen.getByText("Edit server")).toBeInTheDocument();
    expect(screen.getByTestId("name-input")).toHaveValue("Local");
    expect(screen.getByTestId("url-input")).toHaveValue("http://localhost:14096");
    expect(screen.getByTestId("username-input")).toHaveValue("admin");
    expect(screen.getByTestId("password-input")).toHaveValue("");
    expect(screen.getByTestId("save-server")).toHaveTextContent("Save changes");

    fireEvent.input(screen.getByTestId("name-input"), { target: { value: "Local 2" } });
    invokeMock.mockResolvedValueOnce({ ...editEntry, name: "Local 2" });
    fireEvent.click(screen.getByTestId("save-server"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("update_server", {
        id: "srv-1",
        entry: {
          name: "Local 2",
          url: "http://localhost:14096",
          username: "admin",
          password: "secret",
        },
      }),
    );
    // The emitted entry is password-stripped.
    await waitFor(() =>
      expect(onAdded).toHaveBeenCalledWith({
        id: "srv-1",
        name: "Local 2",
        url: "http://localhost:14096",
        username: "admin",
        createdAt: 123,
      }),
    );
  });

  it("overrides the stored password when a new one is typed", async () => {
    render(() => <AddServer server={editEntry} onAdded={vi.fn()} />);
    fireEvent.input(screen.getByTestId("password-input"), { target: { value: "newpw" } });
    invokeMock.mockResolvedValueOnce({ ...editEntry, password: "newpw" });
    fireEvent.click(screen.getByTestId("save-server"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("update_server", {
        id: "srv-1",
        entry: {
          name: "Local",
          url: "http://localhost:14096",
          username: "admin",
          password: "newpw",
        },
      }),
    );
  });

  it("uses the stored password for probes while editing", async () => {
    invokeMock.mockResolvedValue({
      serverId: "probe",
      healthy: true,
      version: "1.0",
      latencyMs: 5,
      failCount: 0,
      status: "ok",
    });
    render(() => <AddServer server={editEntry} onAdded={vi.fn()} />);
    fireEvent.click(screen.getByTestId("test-connection"));

    await waitFor(() => expect(screen.getByTestId("probe-success")).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith("probe_server", {
      url: "http://localhost:14096",
      auth: { username: "admin", password: "secret" },
    });
  });

  it("shows an inline error when the update fails", async () => {
    invokeMock.mockRejectedValue({
      status: 500,
      code: "persist",
      message: "store failed",
      retriable: false,
    });
    render(() => <AddServer server={editEntry} onAdded={vi.fn()} />);
    fireEvent.input(screen.getByTestId("name-input"), { target: { value: "Local 2" } });
    fireEvent.click(screen.getByTestId("save-server"));

    await waitFor(() => {
      expect(screen.getByTestId("save-error")).toHaveTextContent("store failed");
    });
  });
});
