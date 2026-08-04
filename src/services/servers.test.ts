// L1 tests for the server registry wrappers (TASK-M1-03/05): invoke arg
// assembly for each command and ApiError mapping on rejection.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { addServer, listServers, probeServer, removeServer, updateServer } from "./servers.js";

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
