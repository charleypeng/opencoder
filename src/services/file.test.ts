// L1 tests for the file domain service (TASK-M4-01): exact invoke payload
// assembly per method and ApiError passthrough. The optional L3 contract
// block runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createFileService } from "./file.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("createFileService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("tree lists the workspace root without a path", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createFileService(makeClient()).tree();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/file" },
    });
  });

  it("tree passes path and directory through", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createFileService(makeClient()).tree("src/features", "/mock/projects/opencode-demo");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/file",
        query: { path: "src/features", directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("content requires path and passes directory through", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { type: "text", content: "" } }));
    await createFileService(makeClient()).content("README.md", "/mock/projects/opencode-demo");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/file/content",
        query: { path: "README.md", directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("content resolves the FileContent payload", async () => {
    const content = { type: "text", content: "hi", mimeType: "text/plain" };
    invokeMock.mockResolvedValue(httpResponse({ body: content }));

    await expect(createFileService(makeClient()).content("README.md")).resolves.toEqual(content);
  });

  it("status lists tracked files without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createFileService(makeClient()).status();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/file/status" },
    });
  });

  it("status passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createFileService(makeClient()).status("/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/file/status",
        query: { directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("passes ApiError rejections through unchanged", async () => {
    invokeMock.mockRejectedValue({
      status: 404,
      code: "http",
      message: "missing",
      retriable: false,
    });
    const service = createFileService(makeClient());
    await expect(service.tree()).rejects.toBeInstanceOf(ApiError);
    await expect(service.content("nope.ts")).rejects.toMatchObject({
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
  const service = createFileService(client);

  it("tree returns FileNode entries", async () => {
    const nodes = await service.tree();
    expect(nodes.length).toBeGreaterThan(0);
    const first = nodes[0];
    expect(first.name).toBeTypeOf("string");
    expect(first.path).toBeTypeOf("string");
    expect(first.absolute).toBeTypeOf("string");
    expect(["file", "directory"]).toContain(first.type);
    expect(first.ignored).toBeTypeOf("boolean");
  });

  it("content returns text content", async () => {
    const content = await service.content("README.md");
    expect(["text", "binary"]).toContain(content.type);
    expect(content.content).toBeTypeOf("string");
  });

  it("status returns tracked file statuses", async () => {
    const entries = await service.status();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].path).toBeTypeOf("string");
    expect(["added", "deleted", "modified"]).toContain(entries[0].status);
  });
});
