// L1 tests for the find domain service (TASK-M3-08 / TASK-M4-01): the
// factory assembles the right GET requests for file/symbol/text search — the
// required query/pattern params are always sent and an explicit directory is
// passed through; without one the client's global directory injection takes
// over (same contract as createSessionService). The optional L3 contract
// block runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
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

  it("searches symbols with the required query param", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createFindService(makeClient()).symbols("PromptBox");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/find/symbol", query: { query: "PromptBox" } },
    });
  });

  it("passes an explicit directory to the symbol search", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createFindService(makeClient()).symbols("PromptBox", "/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/find/symbol",
        query: { query: "PromptBox", directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("propagates the returned symbol list", async () => {
    const symbols = [{ name: "PromptBox", kind: 12, location: { uri: "file:///a.ts", range: {} } }];
    invokeMock.mockResolvedValue(httpResponse({ body: symbols }));

    await expect(createFindService(makeClient()).symbols("PromptBox")).resolves.toEqual(symbols);
  });

  it("search sends the required pattern param", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createFindService(makeClient()).search("createSignal");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/find", query: { pattern: "createSignal" } },
    });
  });

  it("search passes the directory through", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createFindService(makeClient()).search("createSignal", {
      dir: "/mock/projects/opencode-demo",
    });

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/find",
        query: { pattern: "createSignal", directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("propagates the returned text matches", async () => {
    const matches = [
      {
        path: { text: "a.ts" },
        lines: { text: "x" },
        line_number: 1,
        absolute_offset: 0,
        submatches: [],
      },
    ];
    invokeMock.mockResolvedValue(httpResponse({ body: matches }));

    await expect(createFindService(makeClient()).search("x")).resolves.toEqual(matches);
  });
});

const mockUrl = process.env.MOCK_URL;

describe.skipIf(!mockUrl)("L3 contract against live mock server", () => {
  const client = new ApiClient({
    request: (input) => fetchTransport.request({ ...input, url: mockUrl }),
  });
  const service = createFindService(client);

  it("files returns matching paths", async () => {
    const files = await service.files("PromptBox");
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toContain("PromptBox");
  });

  it("symbols returns workspace symbols", async () => {
    const symbols = await service.symbols("Prompt");
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols[0].name).toBeTypeOf("string");
    expect(symbols[0].kind).toBeTypeOf("number");
    expect(symbols[0].location?.uri).toBeTypeOf("string");
  });

  it("search returns text matches", async () => {
    const matches = await service.search("Prompt");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].path.text).toBeTypeOf("string");
    expect(matches[0].line_number).toBeTypeOf("number");
    expect(Array.isArray(matches[0].submatches)).toBe(true);
  });
});
