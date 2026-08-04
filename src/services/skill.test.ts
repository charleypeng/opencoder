// L1 tests for the skill domain service (TASK-M5-08): exact invoke payload
// assembly for GET /skill and ApiError passthrough. The optional L3
// contract block runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createSkillService } from "./skill.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("createSkillService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs /skill without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createSkillService(makeClient()).list();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/skill" },
    });
  });

  it("list passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createSkillService(makeClient()).list("/mock/projects/opencode-demo");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/skill",
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("list resolves the skill array from the response body", async () => {
    const body = [
      {
        name: "research",
        description: "Deep research workflow",
        location: "/mock/skills/research/SKILL.md",
        content: "# research\n",
      },
    ];
    invokeMock.mockResolvedValue(httpResponse({ body }));
    await expect(createSkillService(makeClient()).list()).resolves.toEqual(body);
  });

  it("passes ApiError through on failure", async () => {
    invokeMock.mockRejectedValue({
      status: 500,
      code: "http",
      message: "skills boom",
      retriable: true,
    });
    await expect(createSkillService(makeClient()).list()).rejects.toMatchObject({
      status: 500,
      code: "http",
      retriable: true,
    });
  });
});

const mockUrl = process.env.MOCK_URL;

describe.skipIf(!mockUrl)("L3 contract against live mock server", () => {
  const client = new ApiClient({
    request: (input) => fetchTransport.request({ ...input, url: mockUrl }),
  });
  const service = createSkillService(client);

  it("list returns available skills with the schema shape", async () => {
    const skills = await service.list();
    expect(skills.length).toBeGreaterThanOrEqual(3);
    for (const skill of skills) {
      expect(skill.name).toBeTypeOf("string");
      expect(skill.name).not.toBe("");
      expect(skill.location).toBeTypeOf("string");
      expect(skill.content).toBeTypeOf("string");
    }
  });
});
