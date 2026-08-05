// L1 tests for the permission domain service (TASK-M5-01): exact invoke
// payload assembly per method (list + reply) and ApiError passthrough. The
// optional L3 contract block runs against a live mock server when MOCK_URL
// is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createPermissionService } from "./permission.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("createPermissionService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs /permission without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createPermissionService(makeClient()).list();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/permission" },
    });
  });

  it("list passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createPermissionService(makeClient()).list("/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/permission",
        query: { directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("reply POSTs the reply body to /permission/{requestID}/reply", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await createPermissionService(makeClient()).reply("per_1", "once");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/permission/per_1/reply",
        body: { reply: "once" },
      },
    });
  });

  it("reply passes always / reject through and an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    const service = createPermissionService(makeClient());

    await service.reply("per_2", "always", "/mock/projects/opencode-demo");
    expect(invokeMock).toHaveBeenLastCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/permission/per_2/reply",
        body: { reply: "always" },
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });

    await service.reply("per_3", "reject");
    expect(invokeMock).toHaveBeenLastCalledWith("http_request", {
      request: { method: "POST", path: "/permission/per_3/reply", body: { reply: "reject" } },
    });
  });

  it("list resolves the request array from the response body", async () => {
    const body = [
      {
        id: "per_1",
        sessionID: "ses_1",
        permission: "bash",
        patterns: [],
        metadata: {},
        always: [],
      },
    ];
    invokeMock.mockResolvedValue(httpResponse({ body }));
    await expect(createPermissionService(makeClient()).list()).resolves.toEqual(body);
  });

  it("reply resolves the boolean result", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await expect(createPermissionService(makeClient()).reply("per_1", "reject")).resolves.toBe(
      true,
    );
  });

  it("passes ApiError through on failure", async () => {
    invokeMock.mockRejectedValue({
      status: 404,
      code: "http",
      message: "not found",
      retriable: false,
    });
    const service = createPermissionService(makeClient());
    await expect(service.list()).rejects.toBeInstanceOf(ApiError);
    await expect(service.reply("per_1", "once")).rejects.toMatchObject({
      status: 404,
      code: "http",
      retriable: false,
    });
  });

  it("savedList GETs /api/permission/saved and resolves the envelope", async () => {
    const body = {
      data: [
        { id: "r1", projectID: "project-mock-1", action: "allow", resource: "bash" },
        { id: "r2", projectID: "project-mock-1", action: "deny", resource: "edit:src/x" },
      ],
    };
    invokeMock.mockResolvedValue(httpResponse({ body }));
    await expect(createPermissionService(makeClient()).savedList()).resolves.toEqual(body);

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/api/permission/saved" },
    });
  });

  it("savedRemove DELETEs /api/permission/saved/{id} and resolves the 204 body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ status: 204 }));
    await expect(createPermissionService(makeClient()).savedRemove("r1")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "DELETE", path: "/api/permission/saved/r1" },
    });
  });
});

const mockUrl = process.env.MOCK_URL;

describe.skipIf(!mockUrl)("L3 contract against live mock server", () => {
  const client = new ApiClient({
    request: (input) => fetchTransport.request({ ...input, url: mockUrl }),
  });
  const service = createPermissionService(client);

  it("list returns pending permission requests", async () => {
    const requests = await service.list();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0].id).toBeTypeOf("string");
    expect(requests[0].sessionID).toBeTypeOf("string");
    expect(requests[0].permission).toBeTypeOf("string");
    expect(Array.isArray(requests[0].patterns)).toBe(true);
  });

  it("reply resolves true for a valid reply", async () => {
    await expect(service.reply("per_1", "once")).resolves.toBe(true);
  });
});
