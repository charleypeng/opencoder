// L1 tests for the provider domain service (TASK-M5-05): `list` GETs
// /provider and `configProviders` GETs /config/providers — both without a
// query by default, both forwarding the explicit directory query (same
// convention as the agent/permission/command services) — and each resolves
// its full response shape.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, invokeTransport, type HttpResponse } from "./client.js";
import {
  createProviderService,
  type ConfigProvidersResponse,
  type ProviderListResponse,
} from "./provider.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

const LIST_BODY: ProviderListResponse = {
  all: [
    {
      id: "openai",
      name: "OpenAI",
      source: "env",
      env: ["OPENAI_API_KEY"],
      options: {},
      models: {},
    },
  ],
  default: { openai: "gpt-5" },
  connected: ["openai"],
};

const CONFIG_BODY: ConfigProvidersResponse = {
  providers: LIST_BODY.all,
  default: { openai: "gpt-5" },
};

describe("createProviderService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs /provider without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: LIST_BODY }));
    await createProviderService(makeClient()).list();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/provider" },
    });
  });

  it("list passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: LIST_BODY }));
    await createProviderService(makeClient()).list("/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/provider",
        query: { directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("list resolves the catalog, default models and connected ids", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: LIST_BODY }));

    const result = await createProviderService(makeClient()).list();

    expect(result).toEqual(LIST_BODY);
  });

  it("configProviders GETs /config/providers without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: CONFIG_BODY }));
    await createProviderService(makeClient()).configProviders();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/config/providers" },
    });
  });

  it("configProviders passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: CONFIG_BODY }));
    await createProviderService(makeClient()).configProviders("/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/config/providers",
        query: { directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("configProviders resolves the providers and default models", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: CONFIG_BODY }));

    const result = await createProviderService(makeClient()).configProviders();

    expect(result).toEqual(CONFIG_BODY);
  });
});
