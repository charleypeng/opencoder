// L1 tests for the LSP + formatter domain service (TASK-M9-07): exact
// invoke payload assembly for GET /lsp and GET /formatter (directory
// passthrough) and ApiError passthrough. The optional L3 contract block
// runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createLspService } from "./lsp.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("createLspService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("status GETs /lsp without query by default and resolves the array", async () => {
    const body = [
      { id: "lsp_1", name: "typescript-language-server", root: "/x", status: "connected" },
    ];
    invokeMock.mockResolvedValue(httpResponse({ body }));
    await expect(createLspService(makeClient()).status()).resolves.toEqual(body);

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/lsp" },
    });
  });

  it("status passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createLspService(makeClient()).status("/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/lsp",
        query: { directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("formatters GETs /formatter with the directory", async () => {
    const body = [
      { name: "biome", extensions: ["ts"], enabled: true },
      { name: "prettier", extensions: ["md"], enabled: false },
    ];
    invokeMock.mockResolvedValue(httpResponse({ body }));
    await expect(
      createLspService(makeClient()).formatters("/mock/projects/opencode-demo"),
    ).resolves.toEqual(body);

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/formatter",
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("passes ApiError through on failure", async () => {
    invokeMock.mockRejectedValue({
      status: 500,
      code: "http",
      message: "boom",
      retriable: true,
    });
    const service = createLspService(makeClient());
    await expect(service.status()).rejects.toBeInstanceOf(ApiError);
    await expect(service.formatters()).rejects.toMatchObject({ status: 500, retriable: true });
  });
});

const mockUrl = process.env.MOCK_URL;

describe.skipIf(!mockUrl)("L3 contract against live mock server", () => {
  const client = new ApiClient({
    request: (input) => fetchTransport.request({ ...input, url: mockUrl }),
  });
  const service = createLspService(client);

  it("status returns LSP entries with the contract shape", async () => {
    const entries = await service.status();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].id).toBeTypeOf("string");
    expect(entries[0].name).toBeTypeOf("string");
    expect(entries[0].root).toBeTypeOf("string");
    expect(["connected", "error"]).toContain(entries[0].status);
  });

  it("formatters return the enabled/disabled shape", async () => {
    const formatters = await service.formatters();
    expect(formatters.length).toBeGreaterThan(0);
    expect(formatters[0].name).toBeTypeOf("string");
    expect(Array.isArray(formatters[0].extensions)).toBe(true);
    expect(typeof formatters[0].enabled).toBe("boolean");
  });
});
