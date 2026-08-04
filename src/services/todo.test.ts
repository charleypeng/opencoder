// L1 tests for the todo domain service (TASK-M3-07): exact invoke payload
// assembly per method and ApiError passthrough. The optional L3 contract
// block runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createTodoService } from "./todo.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

const FIXTURE = [
  { content: "a", status: "pending", priority: "high" },
  { content: "b", status: "completed", priority: "low" },
];

describe("todo service (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs /session/{id}/todo without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: FIXTURE }));
    const result = await createTodoService(makeClient()).list("sess_01");
    expect(result).toEqual(FIXTURE);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/session/sess_01/todo" },
    });
  });

  it("list passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createTodoService(makeClient()).list("sess_01", "/project/alpha");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/session/sess_01/todo",
        query: { directory: "/project/alpha" },
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
    const service = createTodoService(makeClient());
    await expect(service.list("sess_99")).rejects.toBeInstanceOf(ApiError);
    await expect(service.list("sess_99")).rejects.toMatchObject({
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
  const service = createTodoService(client);

  it("list returns todo entries", async () => {
    const todos = await service.list("sess_01");
    expect(todos.length).toBeGreaterThan(0);
    expect(todos[0].content).toBeTypeOf("string");
    expect(todos[0].status).toBeTypeOf("string");
    expect(todos[0].priority).toBeTypeOf("string");
  });
});
