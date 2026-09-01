// L1 tests for the server registry wrappers (TASK-M1-03/05): invoke arg
// assembly for each command and ApiError mapping on rejection.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import {
  addServer,
  listServers,
  probeServer,
  removeServer,
  startLocalServer,
  stopLocalServer,
  updateServer,
} from "./servers.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("server registry wrappers", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("listServers invokes list_servers without args", async () => {
    invokeMock.mockResolvedValue([{ id: "srv-1", name: "Local" }]);
    await expect(listServers()).resolves.toEqual([{ id: "srv-1", name: "Local" }]);
    expect(invokeMock).toHaveBeenCalledWith("list_servers");
  });

  it("addServer passes the entry as input", async () => {
    invokeMock.mockResolvedValue({ id: "srv-1", createdAt: 1 });
    await addServer({ name: "Local", url: "http://localhost:14096" });
    expect(invokeMock).toHaveBeenCalledWith("add_server", {
      entry: { name: "Local", url: "http://localhost:14096" },
    });
  });

  it("addServer forwards optional auth fields", async () => {
    invokeMock.mockResolvedValue({ id: "srv-1" });
    await addServer({
      name: "Remote",
      url: "http://example.com",
      username: "admin",
      password: "secret",
    });
    expect(invokeMock).toHaveBeenCalledWith("add_server", {
      entry: {
        name: "Remote",
        url: "http://example.com",
        username: "admin",
        password: "secret",
      },
    });
  });

  it("updateServer passes id and entry", async () => {
    invokeMock.mockResolvedValue({ id: "srv-1", name: "Renamed" });
    await updateServer("srv-1", { name: "Renamed", url: "http://localhost:14096" });
    expect(invokeMock).toHaveBeenCalledWith("update_server", {
      id: "srv-1",
      entry: { name: "Renamed", url: "http://localhost:14096" },
    });
  });

  it("removeServer passes the id", async () => {
    invokeMock.mockResolvedValue(undefined);
    await removeServer("srv-1");
    expect(invokeMock).toHaveBeenCalledWith("remove_server", { id: "srv-1" });
  });

  it("starts and stops an app-managed local server", async () => {
    invokeMock.mockResolvedValueOnce(1234).mockResolvedValueOnce(undefined);
    await expect(startLocalServer("srv-local")).resolves.toBe(1234);
    await expect(stopLocalServer("srv-local")).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenNthCalledWith(1, "start_local_server", {
      serverId: "srv-local",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "stop_local_server", {
      serverId: "srv-local",
    });
  });

  it("probeServer passes url and auth when auth is given", async () => {
    invokeMock.mockResolvedValue({ serverId: "probe", healthy: true });
    await probeServer("http://localhost:14096", { username: "admin", password: "pw" });
    expect(invokeMock).toHaveBeenCalledWith("probe_server", {
      url: "http://localhost:14096",
      auth: { username: "admin", password: "pw" },
    });
  });

  it("probeServer omits auth when none is given", async () => {
    invokeMock.mockResolvedValue({ serverId: "probe", healthy: true });
    await probeServer("http://localhost:14096");
    expect(invokeMock).toHaveBeenCalledWith("probe_server", {
      url: "http://localhost:14096",
    });
  });
});

describe("error mapping", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps serialized ApiError rejections to ApiError instances", async () => {
    invokeMock.mockRejectedValue({
      status: 500,
      code: "persist",
      message: "store write failed",
      retriable: false,
    });
    await expect(addServer({ name: "x", url: "http://x" })).rejects.toBeInstanceOf(ApiError);
    await expect(addServer({ name: "x", url: "http://x" })).rejects.toMatchObject({
      status: 500,
      code: "persist",
      message: "store write failed",
      retriable: false,
    });
  });

  it("maps generic rejections to code unknown", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));
    await expect(probeServer("http://localhost:14096")).rejects.toMatchObject({
      code: "unknown",
      retriable: false,
    });
  });
});

describe("probe response validation (TASK-M1-09 defense)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a well-formed health payload", async () => {
    invokeMock.mockResolvedValue({ serverId: "probe", healthy: true, status: "ok" });
    await expect(probeServer("http://localhost:14096")).resolves.toMatchObject({ healthy: true });
  });

  it("rejects a payload without the healthy field as invalid_response", async () => {
    invokeMock.mockResolvedValue({ serverId: "probe", status: "ok" });
    await expect(probeServer("http://localhost:14096")).rejects.toMatchObject({
      code: "invalid_response",
      message: "Unexpected response format",
      retriable: false,
    });
  });

  it("rejects a non-object payload as invalid_response", async () => {
    invokeMock.mockResolvedValue(null);
    await expect(probeServer("http://localhost:14096")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects a non-boolean healthy field as invalid_response", async () => {
    invokeMock.mockResolvedValue({ serverId: "probe", healthy: "yes", status: "ok" });
    await expect(probeServer("http://localhost:14096")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

describe("L3 contract: 401 matrix (TASK-M1-09)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps a 401 with wrong credentials to a non-retriable ApiError", async () => {
    invokeMock.mockRejectedValue({
      status: 401,
      code: "http",
      message: '{"error":"unauthorized"}',
      retriable: false,
    });
    await expect(
      probeServer("http://localhost:14096", { username: "admin", password: "wrong" }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      probeServer("http://localhost:14096", { username: "admin", password: "wrong" }),
    ).rejects.toMatchObject({
      status: 401,
      code: "http",
      message: '{"error":"unauthorized"}',
      retriable: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("probe_server", {
      url: "http://localhost:14096",
      auth: { username: "admin", password: "wrong" },
    });
  });

  it("probes with the correct credentials and resolves healthy", async () => {
    invokeMock.mockResolvedValue({
      serverId: "probe",
      healthy: true,
      version: "1.18.11-mock",
      latencyMs: 7,
      failCount: 0,
      status: "ok",
    });
    await expect(
      probeServer("http://localhost:14096", { username: "admin", password: "right" }),
    ).resolves.toMatchObject({ healthy: true, status: "ok" });
    expect(invokeMock).toHaveBeenCalledWith("probe_server", {
      url: "http://localhost:14096",
      auth: { username: "admin", password: "right" },
    });
  });
});
