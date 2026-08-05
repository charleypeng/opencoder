// L1 tests for the log-forwarding domain service (TASK-M9-07): exact
// invoke payload assembly for POST /log (body + directory passthrough) and
// ApiError passthrough. The optional L3 contract block runs against a live
// mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createLogService } from "./log.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("createLogService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("write POSTs /log with the entry body and no query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await createLogService(makeClient()).write({
      service: "opencoder-webview",
      level: "error",
      message: "boom",
    });

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/log",
        body: { service: "opencoder-webview", level: "error", message: "boom" },
      },
    });
  });

  it("write passes the warn level and an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await createLogService(makeClient()).write(
      { service: "opencoder-webview", level: "warn", message: "slow" },
      "/mock/projects/opencode-demo",
    );

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/log",
        query: { directory: "/mock/projects/opencode-demo" },
        body: { service: "opencoder-webview", level: "warn", message: "slow" },
      },
    });
  });

  it("write resolves the boolean result", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await expect(
      createLogService(makeClient()).write({ service: "s", level: "info", message: "hi" }),
    ).resolves.toBe(true);
  });

  it("passes ApiError through on failure", async () => {
    invokeMock.mockRejectedValue({
      status: 400,
      code: "http",
      message: "invalid level",
      retriable: false,
    });
    await expect(
      createLogService(makeClient()).write({ service: "s", level: "info", message: "hi" }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

const mockUrl = process.env.MOCK_URL;

describe.skipIf(!mockUrl)("L3 contract against live mock server", () => {
  const client = new ApiClient({
    request: (input) => fetchTransport.request({ ...input, url: mockUrl }),
  });
  const service = createLogService(client);

  it("write resolves true for a valid entry", async () => {
    await expect(
      service.write({ service: "opencoder-webview", level: "warn", message: "l3 check" }),
    ).resolves.toBe(true);
  });
});
