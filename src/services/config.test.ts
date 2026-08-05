// L1 tests for the config domain service (TASK-M9-05): exact invoke
// payload assembly for GET/PATCH /config, GET/PATCH /global/config and
// POST /instance/dispose, plus ApiError passthrough. The optional L3
// contract block runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createConfigService } from "./config.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

const CONFIG = { model: "gpt-5", share: "manual", autoupdate: true };

describe("createConfigService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("get GETs /config without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: CONFIG }));
    await createConfigService(makeClient()).get();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/config" },
    });
  });

  it("get passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: CONFIG }));
    await createConfigService(makeClient()).get("/mock/projects/opencode-demo");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/config",
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("get resolves the config object from the response body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: CONFIG }));
    await expect(createConfigService(makeClient()).get()).resolves.toEqual(CONFIG);
  });

  it("update PATCHes /config with the partial config body and no query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { ...CONFIG, model: "gpt-4.1" } }));
    await createConfigService(makeClient()).update({ model: "gpt-4.1" });

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "PATCH", path: "/config", body: { model: "gpt-4.1" } },
    });
  });

  it("update passes the directory and a nested patch through", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: CONFIG }));
    await createConfigService(makeClient()).update(
      { agent: { build: { model: "gpt-5" } } },
      "/mock/projects/opencode-demo",
    );

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "PATCH",
        path: "/config",
        query: { directory: "/mock/projects/opencode-demo" },
        body: { agent: { build: { model: "gpt-5" } } },
      },
    });
  });

  it("update resolves the full updated config", async () => {
    const updated = { ...CONFIG, model: "gpt-4.1" };
    invokeMock.mockResolvedValue(httpResponse({ body: updated }));
    await expect(createConfigService(makeClient()).update({ model: "gpt-4.1" })).resolves.toEqual(
      updated,
    );
  });

  it("getGlobal GETs /global/config without query or directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: CONFIG }));
    await createConfigService(makeClient()).getGlobal();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/global/config" },
    });
  });

  it("updateGlobal PATCHes /global/config with the partial body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { ...CONFIG, autoupdate: false } }));
    await createConfigService(makeClient()).updateGlobal({ autoupdate: false });

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "PATCH", path: "/global/config", body: { autoupdate: false } },
    });
  });

  it("dispose POSTs /instance/dispose and resolves the boolean", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await expect(createConfigService(makeClient()).dispose()).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/instance/dispose" },
    });
  });

  it("dispose passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await createConfigService(makeClient()).dispose("/mock/projects/opencode-demo");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/instance/dispose",
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("passes ApiError through on failure", async () => {
    invokeMock.mockRejectedValue({
      status: 400,
      code: "http",
      message: "config boom",
      retriable: false,
    });
    await expect(createConfigService(makeClient()).get()).rejects.toMatchObject({
      status: 400,
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
  const service = createConfigService(client);

  it("reads the project config with the schema keys", async () => {
    const config = await service.get();
    expect(config).toBeTypeOf("object");
    expect(config).not.toBeNull();
    expect(typeof config.model).toBe("string");
    expect(typeof config.share).toBe("string");
  });

  it("PATCH merges a partial config and returns the full updated config", async () => {
    const before = await service.get();
    const patched = await service.update({ share: "auto" });
    expect(patched.share).toBe("auto");
    // Unpatched fields are retained (merge semantics, not replace).
    expect(patched.model).toBe(before.model);
    expect(Object.keys(patched).length).toBeGreaterThanOrEqual(Object.keys(before).length);
  });

  it("reads and updates the global config", async () => {
    const global = await service.getGlobal();
    expect(typeof global.autoupdate).not.toBe("undefined");
    const patched = await service.updateGlobal({ autoupdate: "notify" });
    expect(patched.autoupdate).toBe("notify");
  });

  it("disposes the instance with a boolean result", async () => {
    await expect(service.dispose()).resolves.toBe(true);
  });
});
