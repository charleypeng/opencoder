// L1 tests for the command domain service (TASK-M5-03): exact invoke
// payload assembly per method (list + run) and ApiError passthrough. The
// optional L3 contract block runs against a live mock server when MOCK_URL
// is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createCommandService } from "./command.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("createCommandService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs /command without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createCommandService(makeClient()).list();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/command" },
    });
  });

  it("list passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createCommandService(makeClient()).list("/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/command",
        query: { directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("run POSTs the command body to /session/{id}/command", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { info: {}, parts: [] } }));
    await createCommandService(makeClient()).run("ses_1", {
      command: "init",
      arguments: "A summary of the codebase",
    });

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/session/ses_1/command",
        body: { command: "init", arguments: "A summary of the codebase" },
      },
    });
  });

  it("run accepts empty arguments and an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { info: {}, parts: [] } }));
    await createCommandService(makeClient()).run(
      "ses_2",
      { command: "compact", arguments: "" },
      "/mock/projects/opencode-demo",
    );

    expect(invokeMock).toHaveBeenLastCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/session/ses_2/command",
        body: { command: "compact", arguments: "" },
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("list resolves the command array from the response body", async () => {
    const body = [
      {
        name: "init",
        description: "Initialize a CLAUDE.md file",
        template: "Create a CLAUDE.md file",
        hints: ["A summary of the codebase"],
      },
    ];
    invokeMock.mockResolvedValue(httpResponse({ body }));
    await expect(createCommandService(makeClient()).list()).resolves.toEqual(body);
  });

  it("run resolves the created message info + parts", async () => {
    const body = {
      info: { id: "msg_1", sessionID: "ses_1", role: "assistant" },
      parts: [{ id: "prt_1", type: "text", text: "Done" }],
    };
    invokeMock.mockResolvedValue(httpResponse({ body }));
    await expect(
      createCommandService(makeClient()).run("ses_1", { command: "init", arguments: "" }),
    ).resolves.toEqual(body);
  });

  it("passes ApiError through on failure", async () => {
    invokeMock.mockRejectedValue({
      status: 404,
      code: "http",
      message: "not found",
      retriable: false,
    });
    const service = createCommandService(makeClient());
    await expect(service.list()).rejects.toBeInstanceOf(ApiError);
    await expect(service.run("ses_1", { command: "init", arguments: "" })).rejects.toMatchObject({
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
  const service = createCommandService(client);

  it("list returns available commands with the schema shape", async () => {
    const commands = await service.list();
    expect(commands.length).toBeGreaterThanOrEqual(3);
    expect(commands[0].name).toBeTypeOf("string");
    expect(commands[0].template).toBeTypeOf("string");
    expect(Array.isArray(commands[0].hints)).toBe(true);
  });

  it("run resolves the created assistant message", async () => {
    const result = await service.run("ses_contract", { command: "init", arguments: "" });
    expect(result.info.role).toBe("assistant");
    expect(result.info.sessionID).toBe("ses_contract");
    expect(Array.isArray(result.parts)).toBe(true);
  });
});
