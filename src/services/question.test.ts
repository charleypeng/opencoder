// L1 tests for the question domain service (TASK-M5-02): exact invoke
// payload assembly per method (list + reply + reject) and ApiError
// passthrough. The optional L3 contract block runs against a live mock
// server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createQuestionService } from "./question.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("createQuestionService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs /question without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createQuestionService(makeClient()).list();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/question" },
    });
  });

  it("list passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createQuestionService(makeClient()).list("/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/question",
        query: { directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("reply POSTs the answers body to /question/{requestID}/reply", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await createQuestionService(makeClient()).reply("que_1", [["Incremental"]]);

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/question/que_1/reply",
        body: { answers: [["Incremental"]] },
      },
    });
  });

  it("reply passes a free-input text answer and an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await createQuestionService(makeClient()).reply(
      "que_2",
      [["Use the CLI instead"]],
      "/mock/projects/opencode-demo",
    );

    expect(invokeMock).toHaveBeenLastCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/question/que_2/reply",
        body: { answers: [["Use the CLI instead"]] },
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("reject POSTs to /question/{requestID}/reject without a body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await createQuestionService(makeClient()).reject("que_3");

    expect(invokeMock).toHaveBeenLastCalledWith("http_request", {
      request: { method: "POST", path: "/question/que_3/reject" },
    });
  });

  it("reject passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    await createQuestionService(makeClient()).reject("que_3", "/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenLastCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/question/que_3/reject",
        query: { directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("list resolves the request array from the response body", async () => {
    const body = [
      {
        id: "que_1",
        sessionID: "ses_1",
        questions: [
          {
            question: "Which approach?",
            header: "Approach",
            options: [
              { label: "A", description: "first" },
              { label: "B", description: "second" },
            ],
          },
        ],
      },
    ];
    invokeMock.mockResolvedValue(httpResponse({ body }));
    await expect(createQuestionService(makeClient()).list()).resolves.toEqual(body);
  });

  it("reply / reject resolve the boolean result", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    const service = createQuestionService(makeClient());
    await expect(service.reply("que_1", [["A"]])).resolves.toBe(true);
    await expect(service.reject("que_1")).resolves.toBe(true);
  });

  it("passes ApiError through on failure", async () => {
    invokeMock.mockRejectedValue({
      status: 404,
      code: "http",
      message: "not found",
      retriable: false,
    });
    const service = createQuestionService(makeClient());
    await expect(service.list()).rejects.toBeInstanceOf(ApiError);
    await expect(service.reply("que_1", [["A"]])).rejects.toMatchObject({
      status: 404,
      code: "http",
      retriable: false,
    });
    await expect(service.reject("que_1")).rejects.toMatchObject({
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
  const service = createQuestionService(client);

  it("list returns pending questions", async () => {
    const requests = await service.list();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0].id).toBeTypeOf("string");
    expect(requests[0].sessionID).toBeTypeOf("string");
    expect(Array.isArray(requests[0].questions)).toBe(true);
  });

  it("reply resolves true for a valid answers payload", async () => {
    await expect(service.reply("que_mock_001", [["Incremental"]])).resolves.toBe(true);
  });

  it("reject resolves true", async () => {
    await expect(service.reject("que_mock_002")).resolves.toBe(true);
  });
});
