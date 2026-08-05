// L1 tests for the MCP domain service (TASK-M9-06): exact invoke payload
// assembly for GET/POST /mcp, POST /mcp/{name}/connect + disconnect, the
// OAuth trio (auth start / remove / callback / authenticate / poll) plus
// ApiError passthrough. The optional L3 contract block runs against a
// live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createMcpService, type McpAddInput } from "./mcp.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

const STATUS_MAP = {
  filesystem: { status: "connected" },
  fetch: { status: "failed", error: "spawn ENOENT" },
  legacy: { status: "disabled" },
  github: { status: "needs_auth" },
};

describe("createMcpService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs /mcp without query by default and resolves the status map", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: STATUS_MAP }));
    await expect(createMcpService(makeClient()).list()).resolves.toEqual(STATUS_MAP);

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/mcp" },
    });
  });

  it("list passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: STATUS_MAP }));
    await createMcpService(makeClient()).list("/mock/projects/opencode-demo");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/mcp",
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("add POSTs /mcp with a local config (command array + env) and no query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: STATUS_MAP }));
    const input: McpAddInput = {
      name: "fs",
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
        environment: { API_KEY: "k" },
      },
    };
    await createMcpService(makeClient()).add(input);

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/mcp", body: input },
    });
  });

  it("add POSTs /mcp with a remote config (url + headers) and the directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: STATUS_MAP }));
    const input: McpAddInput = {
      name: "remote-llm",
      config: { type: "remote", url: "https://mcp.example.com/sse", headers: { "X-Key": "v" } },
    };
    await createMcpService(makeClient()).add(input, "/mock/projects/opencode-demo");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/mcp",
        query: { directory: "/mock/projects/opencode-demo" },
        body: input,
      },
    });
  });

  it("add resolves the updated status map", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: STATUS_MAP }));
    await expect(
      createMcpService(makeClient()).add({
        name: "fs",
        config: { type: "local", command: ["npx"] },
      }),
    ).resolves.toEqual(STATUS_MAP);
  });

  it("connect POSTs /mcp/{name}/connect and resolves the boolean", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await expect(createMcpService(makeClient()).connect("legacy")).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/mcp/legacy/connect" },
    });
  });

  it("disconnect POSTs /mcp/{name}/disconnect with the directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await createMcpService(makeClient()).disconnect("filesystem", "/mock/projects/opencode-demo");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/mcp/filesystem/disconnect",
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("authStart POSTs /mcp/{name}/auth and resolves url + state", async () => {
    const auth = {
      authorizationUrl: "https://idp.example.com/auth?state=st1",
      oauthState: "st1",
    };
    invokeMock.mockResolvedValue(httpResponse({ body: auth }));
    await expect(createMcpService(makeClient()).authStart("github")).resolves.toEqual(auth);

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/mcp/github/auth" },
    });
  });

  it("authRemove DELETEs /mcp/{name}/auth", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { success: true } }));
    await expect(createMcpService(makeClient()).authRemove("github")).resolves.toEqual({
      success: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "DELETE", path: "/mcp/github/auth" },
    });
  });

  it("authCallback POSTs /mcp/{name}/auth/callback with the code", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { status: "connected" } }));
    await expect(
      createMcpService(makeClient()).authCallback("github", "mock-oauth-code"),
    ).resolves.toEqual({ status: "connected" });

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/mcp/github/auth/callback",
        body: { code: "mock-oauth-code" },
      },
    });
  });

  it("authAuthenticate POSTs /mcp/{name}/auth/authenticate", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { status: "connected" } }));
    await expect(createMcpService(makeClient()).authAuthenticate("github")).resolves.toEqual({
      status: "connected",
    });

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/mcp/github/auth/authenticate" },
    });
  });

  it("authPoll POSTs /mcp/{name}/auth/authenticate with the mock poll query", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { status: "needs_auth" } }));
    await expect(createMcpService(makeClient()).authPoll("github")).resolves.toEqual({
      status: "needs_auth",
    });

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/mcp/github/auth/authenticate", query: { poll: true } },
    });
  });

  it("passes ApiError through on failure", async () => {
    invokeMock.mockRejectedValue({
      status: 404,
      code: "http",
      message: "McpServerNotFoundError: nope",
      retriable: false,
    });
    await expect(createMcpService(makeClient()).connect("nope")).rejects.toMatchObject({
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
  const service = createMcpService(client);

  it("lists the fixture servers with their status shapes", async () => {
    const map = await service.list();
    expect(typeof map).toBe("object");
    const names = Object.keys(map);
    expect(names.length).toBeGreaterThanOrEqual(4);
    const connected = map["filesystem"];
    expect(connected).toEqual({ status: "connected" });
    // The failed fixture heals via connect tests against a long-lived
    // server, so both shapes are accepted here (the fresh-server failed
    // state is asserted by the mock self-test).
    const fetchStatus = map["fetch"]?.status;
    expect(["failed", "disabled"].includes(fetchStatus ?? "")).toBe(true);
    if (fetchStatus === "failed") {
      expect(typeof (map["fetch"] as { error?: unknown })?.error).toBe("string");
    }
    expect(map["legacy"]).toEqual({ status: "disabled" });
    expect(["needs_auth", "connected"].includes(map["github"]?.status ?? "")).toBe(true);
  });

  it("adds a local and a remote server and connects the result", async () => {
    const local = await service.add({
      name: "l3-local",
      config: { type: "local", command: ["npx", "-y", "pkg"], environment: { A: "b" } },
    });
    expect(local["l3-local"]).toEqual({ status: "disabled" });

    const remote = await service.add({
      name: "l3-remote",
      config: { type: "remote", url: "https://mcp.example.com/sse", headers: { "X-K": "v" } },
    });
    expect(remote["l3-remote"]).toEqual({ status: "disabled" });

    await expect(service.connect("l3-local")).resolves.toBe(true);
    const after = await service.list();
    expect(after["l3-local"]).toEqual({ status: "connected" });

    await expect(service.disconnect("l3-local")).resolves.toBe(true);
    expect((await service.list())["l3-local"]).toEqual({ status: "disabled" });
  });

  it("connects a server and disconnects it again", async () => {
    await expect(service.connect("fetch")).resolves.toBe(true);
    expect((await service.list())["fetch"]).toEqual({ status: "connected" });
    await expect(service.disconnect("fetch")).resolves.toBe(true);
    expect((await service.list())["fetch"]).toEqual({ status: "disabled" });
  });

  it("runs the OAuth auto flow: start, browser visit, poll to connected", async () => {
    // Idempotent reset: a long-lived server may hold a completed
    // authorization from an earlier run (DELETE /mcp/{name}/auth revokes
    // it and the server needs authorization again).
    await service.authRemove("github");
    const auth = await service.authStart("github");
    expect(typeof auth.authorizationUrl).toBe("string");
    expect(typeof auth.oauthState).toBe("string");
    expect(auth.authorizationUrl).toContain("/mcp/oauth/authorize");

    // The authorize URL page simulates the IdP browser round trip.
    const visited = await fetchTransport.request({
      method: "GET",
      path: auth.authorizationUrl.replace(/^https?:\/\/[^/]+/, ""),
      url: mockUrl,
    });
    expect(visited.status).toBe(200);

    const status = await service.authPoll("github");
    expect(status).toEqual({ status: "connected" });
  });

  it("completes the OAuth code flow and rejects a wrong code", async () => {
    await service.authRemove("github");
    await expect(service.authStart("github")).resolves.toMatchObject({
      oauthState: expect.any(String),
    });
    await expect(service.authCallback("github", "mock-oauth-code")).resolves.toEqual({
      status: "connected",
    });

    await expect(service.authCallback("github", "wrong-code")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejects auth on a server without OAuth support", async () => {
    await expect(service.authStart("filesystem")).rejects.toMatchObject({ status: 400 });
  });

  it("removes stored OAuth credentials", async () => {
    const removed = await service.authRemove("github");
    expect(removed).toEqual({ success: true });
    // Revoking the credentials returns an OAuth-capable server to the
    // needs_auth state.
    expect((await service.list())["github"]).toEqual({ status: "needs_auth" });
  });
});
