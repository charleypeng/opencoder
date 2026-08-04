// L1 tests for the PTY domain service (TASK-M6-01): exact invoke payload
// assembly per method and ApiError passthrough. The optional L3 contract
// block runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createPtyService } from "./pty.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("pty service (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs /pty without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [{ id: "pty_abc123" }] }));
    const result = await createPtyService(makeClient()).list();
    expect(result).toEqual([{ id: "pty_abc123" }]);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/pty" },
    });
  });

  it("list passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createPtyService(makeClient()).list("/project/alpha");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/pty", query: { directory: "/project/alpha" } },
    });
  });

  it("create POSTs the command/args/cwd/title body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "pty_created", title: "dev" } }));
    const result = await createPtyService(makeClient()).create({
      command: "pnpm",
      args: ["dev"],
      cwd: "/home/user/project",
      title: "dev server",
    });
    expect(result.id).toBe("pty_created");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/pty",
        body: { command: "pnpm", args: ["dev"], cwd: "/home/user/project", title: "dev server" },
      },
    });
  });

  it("create defaults to an empty body and accepts a directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "pty_created" } }));
    await createPtyService(makeClient()).create(undefined, "/project/alpha");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/pty", body: {}, query: { directory: "/project/alpha" } },
    });
  });

  it("get GETs the parameterized pty path", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "pty_abc123" } }));
    const result = await createPtyService(makeClient()).get("pty_abc123");
    expect(result.id).toBe("pty_abc123");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/pty/pty_abc123" },
    });
  });

  it("update PUTs title and the resize size body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "pty_abc123", title: "renamed" } }));
    const result = await createPtyService(makeClient()).update("pty_abc123", {
      title: "renamed",
      size: { rows: 30, cols: 100 },
    });
    expect(result.title).toBe("renamed");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "PUT",
        path: "/pty/pty_abc123",
        body: { title: "renamed", size: { rows: 30, cols: 100 } },
      },
    });
  });

  it("remove DELETEs the pty", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    const result = await createPtyService(makeClient()).remove("pty_abc123");
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "DELETE", path: "/pty/pty_abc123" },
    });
  });

  it("shells GETs /pty/shells", async () => {
    invokeMock.mockResolvedValue(
      httpResponse({ body: [{ path: "/bin/zsh", name: "zsh", acceptable: true }] }),
    );
    const result = await createPtyService(makeClient()).shells();
    expect(result).toEqual([{ path: "/bin/zsh", name: "zsh", acceptable: true }]);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/pty/shells" },
    });
  });

  it("connectToken POSTs to the connect-token endpoint", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { ticket: "t-1", expires_in: 60 } }));
    const result = await createPtyService(makeClient()).connectToken("pty_abc123");
    expect(result).toEqual({ ticket: "t-1", expires_in: 60 });
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/pty/pty_abc123/connect-token" },
    });
  });

  it("passes ApiError rejections through unchanged", async () => {
    invokeMock.mockRejectedValue({
      status: 404,
      code: "http",
      message: "missing",
      retriable: false,
    });
    const service = createPtyService(makeClient());
    await expect(service.get("pty_99")).rejects.toBeInstanceOf(ApiError);
    await expect(service.get("pty_99")).rejects.toMatchObject({
      status: 404,
      code: "http",
      retriable: false,
    });
  });
});

const mockUrl = process.env.MOCK_URL;

describe.skipIf(!mockUrl)("L3 contract against live mock server", () => {
  const client = new ApiClient({
    request: (input) => fetchTransport.request({ ...input, url: mockUrl }),
  });
  const service = createPtyService(client);

  it("list returns pty fixtures", async () => {
    const ptys = await service.list();
    expect(ptys.length).toBeGreaterThan(0);
    expect(ptys[0].id).toBeTypeOf("string");
    expect(ptys[0].status).toMatch(/running|exited/);
  });

  it("create returns a running pty honoring the command", async () => {
    const created = await service.create({ command: "pnpm", args: ["dev"], title: "Contract pty" });
    expect(created.id).toBeTypeOf("string");
    expect(created.command).toBe("pnpm");
    expect(created.status).toBe("running");
  });

  it("get returns the pty detail", async () => {
    const pty = await service.get("pty_abc123");
    expect(pty.id).toBe("pty_abc123");
    expect(pty.status).toMatch(/running|exited/);
  });

  it("update resizes the pty", async () => {
    const updated = await service.update("pty_abc123", { size: { rows: 40, cols: 120 } });
    expect(updated.id).toBe("pty_abc123");
  });

  it("remove deletes the pty", async () => {
    const removed = await service.remove("pty_abc124");
    expect(removed).toBe(true);
  });

  it("shells returns the shell catalog", async () => {
    const shells = await service.shells();
    expect(shells.length).toBeGreaterThan(0);
    for (const shell of shells) {
      expect(shell.path).toBeTypeOf("string");
      expect(shell.name).toBeTypeOf("string");
      expect(typeof shell.acceptable).toBe("boolean");
    }
  });

  it("connectToken exchanges a ticket", async () => {
    const token = await service.connectToken("pty_abc123");
    expect(token.ticket).toBeTypeOf("string");
    expect(token.expires_in).toBeTypeOf("number");
  });
});
