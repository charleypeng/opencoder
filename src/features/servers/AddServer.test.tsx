// L2 tests for the Add Server wizard (TASK-M1-05): form rendering, URL
// normalization, the probe flow, the save flow and the plain-HTTP warning;
// plus the "Nearby servers" mDNS section (TASK-M1-07): list rendering from
// the Rust cache, event-driven appends, one-click prefill, dedupe by URL
// and the non-Tauri no-op guard.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import AddServer from "./AddServer";
import { isRemotePlainHttp, normalizeServerUrl } from "./url";
import { refreshPlatform } from "../../platform/index.js";
import type { DiscoveredServer } from "../../services/discovery";
import type { ServerEntry } from "../../services/servers";

const { invokeMock, listenMock, scanMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  scanMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("@tauri-apps/plugin-barcode-scanner", () => ({
  scan: scanMock,
  Format: { QRCode: "QR_CODE" },
}));

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

  it("classifies a 401 probe rejection with a credentials hint (TASK-M1-09)", async () => {
    invokeMock.mockRejectedValue({
      status: 401,
      code: "http",
      message: '{"error":"unauthorized"}',
      retriable: false,
    });
    render(() => <AddServer />);
    typeUrl("localhost:14096");
    fireEvent.click(screen.getByTestId("test-connection"));

    await waitFor(() => {
      expect(screen.getByTestId("probe-failure")).toHaveTextContent("Authentication required");
    });
    expect(screen.getByTestId("probe-failure")).toHaveTextContent("unauthorized");
    expect(screen.getByTestId("probe-failure")).toHaveTextContent("Check your credentials");
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

// ---- Nearby servers (TASK-M1-07) ----

const nearbyA: DiscoveredServer = {
  id: "opencode-14096._http._tcp.local.",
  name: "opencode-14096",
  url: "http://192.168.1.5:14096",
  host: "192.168.1.5",
  port: 14096,
};

const nearbyB: DiscoveredServer = {
  id: "opencode-14097._http._tcp.local.",
  name: "opencode-14097",
  url: "http://192.168.1.6:14097",
  host: "192.168.1.6",
  port: 14097,
};

function withTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

function withoutTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, configurable: true });
}

/** Happy-path mock for the discovery commands plus a healthy probe. */
function mockDiscoveryCommands(servers: DiscoveredServer[], addServerResult?: ServerEntry): void {
  listenMock.mockResolvedValue(() => {});
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "get_discovered_servers":
        return Promise.resolve(servers);
      case "start_mdns_discovery":
      case "stop_mdns_discovery":
        return Promise.resolve();
      case "add_server":
        return addServerResult
          ? Promise.resolve(addServerResult)
          : Promise.reject(new Error(`unexpected command ${cmd}`));
      case "probe_server":
        return Promise.resolve({
          serverId: "probe",
          healthy: true,
          version: "1.18.11-mock",
          latencyMs: 12,
          failCount: 0,
          status: "ok",
        });
      default:
        return Promise.reject(new Error(`unexpected command ${cmd}`));
    }
  });
}

describe("AddServer nearby servers", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    withoutTauri();
  });

  it("renders the servers pulled from the Rust cache", async () => {
    withTauri();
    mockDiscoveryCommands([nearbyA, nearbyB]);
    render(() => <AddServer />);

    await waitFor(() => {
      expect(screen.getByTestId(`nearby-${nearbyA.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`nearby-${nearbyB.id}`)).toBeInTheDocument();
    expect(screen.getByText("http://192.168.1.5:14096")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("get_discovered_servers");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("start_mdns_discovery"));
  });

  it("dedupes servers with the same url", async () => {
    withTauri();
    const duplicate = { ...nearbyB, id: "opencode-9999._http._tcp.local.", name: "dup" };
    mockDiscoveryCommands([nearbyA, duplicate]);
    render(() => <AddServer />);

    await waitFor(() => {
      expect(screen.getByTestId(`nearby-${nearbyA.id}`)).toBeInTheDocument();
    });
    // The first entry for a url wins; the other id for the same url never
    // renders (dedupe is by url, not by mDNS instance id).
    expect(screen.getByTestId(`nearby-${duplicate.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`nearby-${nearbyB.id}`)).toBeNull();
  });

  it("adds a server from a server-discovered event", async () => {
    withTauri();
    mockDiscoveryCommands([]);
    render(() => <AddServer />);

    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    const [, onEvent] = listenMock.mock.calls[0];
    onEvent({ payload: nearbyA });

    await waitFor(() => {
      expect(screen.getByTestId(`nearby-${nearbyA.id}`)).toBeInTheDocument();
    });
  });

  it("prefills the form and probes when Add is clicked", async () => {
    withTauri();
    mockDiscoveryCommands([nearbyA]);
    render(() => <AddServer />);

    fireEvent.click(await screen.findByTestId(`add-nearby-${nearbyA.id}`));

    expect(screen.getByTestId("name-input")).toHaveValue(nearbyA.name);
    expect(screen.getByTestId("url-input")).toHaveValue(nearbyA.url);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("probe_server", { url: nearbyA.url });
    });
  });

  it("removes a nearby server from the list once it is saved", async () => {
    withTauri();
    const saved: ServerEntry = {
      id: "srv-1",
      name: nearbyA.name,
      url: nearbyA.url,
      createdAt: 123,
    };
    mockDiscoveryCommands([nearbyA], { ...saved, password: "secret" });
    render(() => <AddServer />);

    fireEvent.click(await screen.findByTestId(`add-nearby-${nearbyA.id}`));
    fireEvent.click(screen.getByTestId("save-server"));

    await waitFor(() => {
      expect(screen.queryByTestId(`nearby-${nearbyA.id}`)).toBeNull();
    });
  });

  it("shows the scanning indicator and then the empty note without results", async () => {
    withoutTauri();
    vi.useFakeTimers();
    render(() => <AddServer />);

    expect(screen.getByTestId("mdns-scanning")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(4000);
    expect(screen.getByTestId("mdns-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("mdns-scanning")).toBeNull();
  });

  it("is a quiet no-op outside Tauri", async () => {
    withoutTauri();
    render(() => <AddServer />);

    expect(screen.queryByTestId(`nearby-${nearbyA.id}`)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(listenMock).not.toHaveBeenCalled();
  });

  it("hides the section in edit mode", () => {
    withTauri();
    mockDiscoveryCommands([nearbyA]);
    render(() => (
      <AddServer
        server={{ id: "srv-1", name: "Local", url: "http://localhost:14096", createdAt: 1 }}
        onAdded={vi.fn()}
      />
    ));
    expect(screen.queryByTestId("nearby-servers")).toBeNull();
  });
});

// ---- QR scan entry (TASK-M7-08) ----

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ORIGINAL_UA = window.navigator.userAgent;

function withMobilePlatform(): void {
  Object.defineProperty(window.navigator, "userAgent", { value: IPHONE_UA, configurable: true });
  refreshPlatform();
}

describe("AddServer QR scan (TASK-M7-08)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    withoutTauri();
    Object.defineProperty(window.navigator, "userAgent", {
      value: ORIGINAL_UA,
      configurable: true,
    });
    refreshPlatform();
  });

  it("hides the scan button without scanEnabled", () => {
    withTauri();
    withMobilePlatform();
    render(() => <AddServer />);
    expect(screen.queryByTestId("scan-qr-button")).toBeNull();
  });

  it("shows the scan button only on Tauri mobile with scanEnabled", () => {
    withTauri();
    withMobilePlatform();
    const { unmount } = render(() => <AddServer scanEnabled />);
    expect(screen.getByTestId("scan-qr-button")).toBeInTheDocument();
    unmount();

    withoutTauri();
    render(() => <AddServer scanEnabled />);
    expect(screen.queryByTestId("scan-qr-button")).toBeNull();
  });

  it("never shows the scan button in edit mode", () => {
    withTauri();
    withMobilePlatform();
    render(() => (
      <AddServer
        scanEnabled
        server={{ id: "srv-1", name: "Local", url: "http://localhost:14096", createdAt: 1 }}
      />
    ));
    expect(screen.queryByTestId("scan-qr-button")).toBeNull();
  });

  it("prefills the form from a scanned connect URL and auto-probes", async () => {
    withTauri();
    withMobilePlatform();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "probe_server") {
        return Promise.resolve({
          serverId: "probe",
          healthy: true,
          version: "1.18.11-mock",
          latencyMs: 12,
          failCount: 0,
          status: "ok",
        });
      }
      return Promise.resolve([]);
    });
    render(() => <AddServer scanEnabled />);

    scanMock.mockResolvedValue({
      content: "opencode://connect?url=http%3A%2F%2F192.168.1.5%3A14096&name=Home",
      format: "QR_CODE",
      bounds: null,
    });
    fireEvent.click(screen.getByTestId("scan-qr-button"));

    await waitFor(() => expect(screen.getByTestId("name-input")).toHaveValue("Home"));
    expect(screen.getByTestId("url-input")).toHaveValue("http://192.168.1.5:14096");
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("probe_server", {
        url: "http://192.168.1.5:14096",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("probe-success")).toBeInTheDocument());
  });

  it("rejects a scanned payload that is not a connect URL", async () => {
    withTauri();
    withMobilePlatform();
    render(() => <AddServer scanEnabled />);

    scanMock.mockResolvedValue({ content: "https://example.com", format: "QR_CODE", bounds: null });
    fireEvent.click(screen.getByTestId("scan-qr-button"));

    await waitFor(() =>
      expect(screen.getByTestId("scan-error")).toHaveTextContent(
        "That QR code is not an OpenCode server link.",
      ),
    );
    expect(screen.getByTestId("name-input")).toHaveValue("");
    expect(screen.getByTestId("url-input")).toHaveValue("");
    expect(invokeMock).not.toHaveBeenCalledWith("probe_server", expect.anything());
  });

  it("shows a camera error when the scan fails", async () => {
    withTauri();
    withMobilePlatform();
    render(() => <AddServer scanEnabled />);

    scanMock.mockRejectedValue(new Error("camera permission denied"));
    fireEvent.click(screen.getByTestId("scan-qr-button"));

    await waitFor(() =>
      expect(screen.getByTestId("scan-error")).toHaveTextContent(
        "Could not start the camera. Check the camera permission and try again.",
      ),
    );
  });
});
