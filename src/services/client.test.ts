// L1 tests for the ApiClient facade (TASK-M1-01): invoke payload assembly,
// ApiError mapping, and the dev-only fetch transport. The optional L3 contract
// block runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, getApiClient, invokeTransport } from "./client.js";
import type { HttpResponse } from "./client.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(getDirectory?: () => string | undefined): ApiClient {
  return new ApiClient(invokeTransport, { getDirectory });
}

describe("ApiClient invoke transport (payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("GET assembles the invoke payload with directory injection", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { healthy: true } }));
    const client = makeClient(() => "/project/alpha");
    const result = await client.get("/global/health", { query: { detail: "full" } });
    expect(result).toEqual({ healthy: true });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/global/health",
        query: { detail: "full", directory: "/project/alpha" },
      },
    });
  });

  it("POST serializes body and skips empty query", async () => {
    invokeMock.mockResolvedValue(httpResponse());
    const client = makeClient();
    await client.post("/log", { body: { level: "info", message: "hi" } });
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/log",
        body: { level: "info", message: "hi" },
      },
    });
  });

  it("passes through auth, timeout and request id", async () => {
    invokeMock.mockResolvedValue(httpResponse());
    const client = makeClient();
    await client.get("/global/health", {
      serverID: "srv-1",
      auth: { username: "user", password: "pass" },
      timeoutMs: 5_000,
      requestID: "req-42",
    });
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/global/health",
        serverID: "srv-1",
        auth: { username: "user", password: "pass" },
        timeoutMs: 5_000,
        requestID: "req-42",
      },
    });
  });

  it("does not inject directory when none is active", async () => {
    invokeMock.mockResolvedValue(httpResponse());
    const client = makeClient();
    await client.get("/global/health");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/global/health" },
    });
  });

  it("returns the raw response through request()", async () => {
    const response = httpResponse({ status: 201, headers: { "x-test": "1" }, body: { ok: true } });
    invokeMock.mockResolvedValue(response);
    const client = makeClient();
    const result = await client.request("POST", "/log", { body: {} });
    expect(result).toEqual(response);
  });
});

describe("ApiClient error mapping", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps serialized ApiError rejections to ApiError instances", async () => {
    invokeMock.mockRejectedValue({
      status: 401,
      code: "http",
      message: "unauthorized",
      retriable: false,
    });
    const client = makeClient();
    await expect(client.get("/global/health")).rejects.toBeInstanceOf(ApiError);
    await expect(client.get("/global/health")).rejects.toMatchObject({
      status: 401,
      code: "http",
      message: "unauthorized",
      retriable: false,
    });
  });

  it("maps non-ApiError rejections to code unknown", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));
    const client = makeClient();
    await expect(client.get("/global/health")).rejects.toBeInstanceOf(ApiError);
    await expect(client.get("/global/health")).rejects.toMatchObject({
      code: "unknown",
      retriable: false,
    });
  });
});

function mockFetchResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { entries: () => [] },
    text: async () => body,
  } as unknown as Response;
}

describe("fetch transport (dev-only)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs with query and returns parsed body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse(200, JSON.stringify({ healthy: true })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient(fetchTransport);
    const result = await client.get("/global/health", { query: { detail: "full" } });
    expect(result).toEqual({ healthy: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:14096/global/health?detail=full");
    expect(init.method).toBe("GET");
  });

  it("injects Basic Auth header when password is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient(fetchTransport);
    await client.get("/global/health", { auth: { username: "user", password: "p@ss" } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Basic ${btoa("user:p@ss")}`);
  });

  it("classifies 401 as non-retriable http error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(401, '{"error":"unauthorized"}'));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient(fetchTransport);
    await expect(client.get("/global/health")).rejects.toMatchObject({
      status: 401,
      code: "http",
      retriable: false,
    });
  });

  it("classifies 500 as retriable http error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(500, '{"error":"boom"}'));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient(fetchTransport);
    await expect(client.get("/global/health")).rejects.toMatchObject({
      status: 500,
      code: "http",
      retriable: true,
    });
  });

  it("classifies network failures as network", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient(fetchTransport);
    await expect(client.get("/global/health")).rejects.toMatchObject({
      code: "network",
      retriable: true,
    });
  });

  it("classifies timeouts as timeout", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("The operation timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient(fetchTransport);
    await expect(client.get("/global/health")).rejects.toMatchObject({
      code: "timeout",
      retriable: true,
    });
  });
});

describe("default transport selection", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the invoke transport by default", async () => {
    invokeMock.mockResolvedValue(httpResponse());
    const client = getApiClient();
    await client.get("/global/health");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("uses the fetch transport when VITE_TRANSPORT=fetch", async () => {
    vi.stubEnv("VITE_TRANSPORT", "fetch");
    vi.resetModules();
    const fresh = await import("./client.js");
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);
    const client = fresh.getApiClient();
    await client.get("/global/health");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

const mockUrl = process.env.MOCK_URL;

describe.skipIf(!mockUrl)("L3 contract against live mock server", () => {
  it("GET /global/health returns the healthy fixture", async () => {
    const response = await fetchTransport.request({
      url: mockUrl,
      method: "GET",
      path: "/global/health",
    });
    expect(response.status).toBe(200);
    expect((response.body as { healthy: boolean }).healthy).toBe(true);
  });

  it("POST /log is assembled and 501 is classified as retriable http", async () => {
    const err = await fetchTransport
      .request({
        url: mockUrl,
        method: "POST",
        path: "/log",
        body: { level: "info", message: "contract" },
      })
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(ApiError);
    const apiError = err as ApiError;
    expect(apiError.status).toBe(501);
    expect(apiError.code).toBe("http");
    expect(apiError.retriable).toBe(true);
  });

  it("fault-injected 401 is classified as non-retriable http", async () => {
    const err = await fetchTransport
      .request({ url: mockUrl, method: "GET", path: "/global/health", query: { __fail: "401" } })
      .catch((error: unknown) => error);
    const apiError = err as ApiError;
    expect(apiError.status).toBe(401);
    expect(apiError.code).toBe("http");
    expect(apiError.retriable).toBe(false);
  });
});
