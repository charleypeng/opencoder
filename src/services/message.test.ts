// L1 tests for the message domain service (TASK-M2-01): exact invoke payload
// assembly per method and ApiError passthrough. The optional L3 contract
// block runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createMessageService } from "./message.js";
import type { components } from "./api/schema.js";

type Part = components["schemas"]["Part"];

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("message service (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs the session message path without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [{ info: { id: "msg_01" }, parts: [] }] }));
    const result = await createMessageService(makeClient()).list("sess_01");
    expect(result).toEqual([{ info: { id: "msg_01" }, parts: [] }]);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/session/sess_01/message" },
    });
  });

  it("list passes limit, before and directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createMessageService(makeClient()).list("sess_01", {
      limit: 10,
      before: "msg_02",
      dir: "/project/alpha",
    });
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/session/sess_01/message",
        query: { limit: 10, before: "msg_02", directory: "/project/alpha" },
      },
    });
  });

  it("list omits undefined pagination options", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createMessageService(makeClient()).list("sess_01", { limit: 5 });
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/session/sess_01/message",
        query: { limit: 5 },
      },
    });
  });

  it("get GETs the single message path", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { info: { id: "msg_02" }, parts: [] } }));
    const result = await createMessageService(makeClient()).get("sess_01", "msg_02");
    expect(result.info.id).toBe("msg_02");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/session/sess_01/message/msg_02" },
    });
  });

  it("get passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { info: { id: "msg_02" }, parts: [] } }));
    await createMessageService(makeClient()).get("sess_01", "msg_02", "/project/alpha");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/session/sess_01/message/msg_02",
        query: { directory: "/project/alpha" },
      },
    });
  });

  it("remove DELETEs the single message path and returns the boolean", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    const result = await createMessageService(makeClient()).remove("sess_01", "msg_02");
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "DELETE", path: "/session/sess_01/message/msg_02" },
    });
  });

  it("updatePart PATCHes the part path with the full part body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "prt_01", text: "edited" } }));
    const part: Part = {
      id: "prt_01",
      sessionID: "sess_01",
      messageID: "msg_02",
      type: "text",
      text: "edited",
    };
    const result = await createMessageService(makeClient()).updatePart(
      "sess_01",
      "msg_02",
      "prt_01",
      part,
    );
    expect(result).toEqual({ id: "prt_01", text: "edited" });
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "PATCH",
        path: "/session/sess_01/message/msg_02/part/prt_01",
        body: part,
      },
    });
  });

  it("removePart DELETEs the part path", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    const result = await createMessageService(makeClient()).removePart(
      "sess_01",
      "msg_02",
      "prt_01",
    );
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "DELETE", path: "/session/sess_01/message/msg_02/part/prt_01" },
    });
  });

  it("updatePart passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: {} }));
    const part: Part = {
      id: "prt_01",
      sessionID: "sess_01",
      messageID: "msg_02",
      type: "text",
      text: "x",
    };
    await createMessageService(makeClient()).updatePart(
      "sess_01",
      "msg_02",
      "prt_01",
      part,
      "/project/alpha",
    );
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "PATCH",
        path: "/session/sess_01/message/msg_02/part/prt_01",
        body: part,
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
    const service = createMessageService(makeClient());
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
  const service = createMessageService(client);

  it("list returns info/part entries", async () => {
    const messages = await service.list("sess_01");
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].info.id).toBeTypeOf("string");
    expect(Array.isArray(messages[0].parts)).toBe(true);
  });

  it("list honors the limit pagination param", async () => {
    const messages = await service.list("sess_01", { limit: 1 });
    expect(messages.length).toBe(1);
  });

  it("get returns the requested message", async () => {
    const message = await service.get("sess_01", "msg_02");
    expect(message.info.id).toBe("msg_02");
    expect(message.parts.length).toBeGreaterThan(0);
  });

  it("remove deletes the message and resolves true", async () => {
    const result = await service.remove("sess_01", "msg_02");
    expect(result).toBe(true);
  });

  it("updatePart patches the part and returns the updated part", async () => {
    const original = await service.get("sess_01", "msg_02");
    const target = original.parts.find((part) => part.type === "text");
    expect(target).toBeDefined();
    const updated = await service.updatePart("sess_01", "msg_02", target!.id, {
      ...target!,
      text: "edited contract text",
    } as Part);
    expect(updated.id).toBe(target!.id);
    expect(updated.type).toBe("text");
    expect(updated).toMatchObject({
      text: "edited contract text",
      sessionID: "sess_01",
      messageID: "msg_02",
    });
  });

  it("removePart deletes the part and resolves true", async () => {
    const result = await service.removePart("sess_01", "msg_02", "part_02");
    expect(result).toBe(true);
  });
});
