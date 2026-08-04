// L1 tests for the project domain service (TASK-M2-01): exact invoke payload
// assembly per method and ApiError passthrough. The optional L3 contract
// block runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createProjectService } from "./project.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("project service (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs /project without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [{ id: "project-mock-1" }] }));
    const result = await createProjectService(makeClient()).list();
    expect(result).toEqual([{ id: "project-mock-1" }]);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/project" },
    });
  });

  it("list passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createProjectService(makeClient()).list("/project/alpha");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/project", query: { directory: "/project/alpha" } },
    });
  });

  it("current GETs /project/current", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "project-mock-1" } }));
    const result = await createProjectService(makeClient()).current();
    expect(result).toEqual({ id: "project-mock-1" });
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/project/current" },
    });
  });

  it("path GETs /path", async () => {
    invokeMock.mockResolvedValue(
      httpResponse({
        body: { home: "/h", state: "/s", config: "/c", worktree: "/w", directory: "/w" },
      }),
    );
    const result = await createProjectService(makeClient()).path("/project/alpha");
    expect(result.directory).toBe("/w");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/path",
        query: { directory: "/project/alpha" },
      },
    });
  });

  it("passes ApiError rejections through unchanged", async () => {
    invokeMock.mockRejectedValue({ status: 500, code: "http", message: "boom", retriable: true });
    const service = createProjectService(makeClient());
    await expect(service.list()).rejects.toBeInstanceOf(ApiError);
    await expect(service.list()).rejects.toMatchObject({
      status: 500,
      code: "http",
      retriable: true,
    });
  });
});

const mockUrl = process.env.MOCK_URL;

describe.skipIf(!mockUrl)("L3 contract against live mock server", () => {
  const client = new ApiClient({
    request: (input) => fetchTransport.request({ ...input, url: mockUrl }),
  });
  const service = createProjectService(client);

  it("list returns the project fixtures", async () => {
    const projects = await service.list();
    expect(projects.length).toBeGreaterThan(0);
    expect(projects[0].id).toBeTypeOf("string");
    expect(projects[0].worktree).toBeTypeOf("string");
  });

  it("current returns the active project", async () => {
    const project = await service.current();
    expect(project.id).toBeTypeOf("string");
  });

  it("path returns the instance path info", async () => {
    const path = await service.path();
    expect(path.directory).toBeTypeOf("string");
    expect(path.worktree).toBeTypeOf("string");
  });
});
