// L1 tests for the agent domain service (TASK-M5-04): `list` GETs /agent
// without a query by default, forwards the explicit directory query (same
// convention as the permission/command services) and resolves the server's
// agents.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, invokeTransport, type HttpResponse } from "./client.js";
import { createAgentService, type Agent } from "./agent.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("createAgentService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs /agent without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createAgentService(makeClient()).list();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/agent" },
    });
  });

  it("list passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createAgentService(makeClient()).list("/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/agent",
        query: { directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("list resolves the agents returned by the server", async () => {
    const agents: Agent[] = [
      { name: "build", mode: "primary", permission: [], options: {} },
      { name: "plan", mode: "primary", permission: [], options: {} },
    ];
    invokeMock.mockResolvedValue(httpResponse({ body: agents }));

    const result = await createAgentService(makeClient()).list();

    expect(result).toEqual(agents);
  });
});
