// L1 tests for the find domain service (TASK-M3-08): the factory assembles
// the right GET requests for file search — the `query` is required and an
// explicit directory is passed through; without one the client's global
// directory injection takes over (same contract as createSessionService).

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, invokeTransport, type HttpResponse } from "./client.js";
import { createFindService } from "./find.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("createFindService", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("searches files with the required query param", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createFindService(makeClient()).files("prompt");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/find/file", query: { query: "prompt" } },
    });
  });

  it("passes an explicit directory through to the search", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createFindService(makeClient()).files("prompt", "/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/find/file",
        query: { query: "prompt", directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("propagates the returned file path list", async () => {
    const paths = ["src/features/sessions/PromptBox.tsx", "src/services/find.ts"];
    invokeMock.mockResolvedValue(httpResponse({ body: paths }));

    await expect(createFindService(makeClient()).files("prompt")).resolves.toEqual(paths);
  });
});
