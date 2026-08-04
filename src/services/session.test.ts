// L1 tests for the session domain service (TASK-M2-01): exact invoke payload
// assembly per method and ApiError passthrough. The optional L3 contract
// block runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createSessionService } from "./session.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("session service (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list GETs /session without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [{ id: "sess_01" }] }));
    const result = await createSessionService(makeClient()).list();
    expect(result).toEqual([{ id: "sess_01" }]);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/session" },
    });
  });

  it("list passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createSessionService(makeClient()).list("/project/alpha");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/session", query: { directory: "/project/alpha" } },
    });
  });

  it("create POSTs the parentID/title body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "sess_created", title: "New" } }));
    const result = await createSessionService(makeClient()).create({
      parentID: "sess_01",
      title: "New",
    });
    expect(result.title).toBe("New");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/session",
        body: { parentID: "sess_01", title: "New" },
      },
    });
  });

  it("create defaults to an empty body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "sess_created" } }));
    await createSessionService(makeClient()).create();
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/session", body: {} },
    });
  });

  it("get GETs the parameterized session path", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "sess_01" } }));
    const result = await createSessionService(makeClient()).get("sess_01");
    expect(result.id).toBe("sess_01");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/session/sess_01" },
    });
  });

  it("update PATCHes the session with the patch body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "sess_01", title: "Renamed" } }));
    const result = await createSessionService(makeClient()).update("sess_01", { title: "Renamed" });
    expect(result.title).toBe("Renamed");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "PATCH",
        path: "/session/sess_01",
        body: { title: "Renamed" },
      },
    });
  });

  it("remove DELETEs the session", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    const result = await createSessionService(makeClient()).remove("sess_01");
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "DELETE", path: "/session/sess_01" },
    });
  });

  it("statusAll GETs /session/status", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { sess_01: { type: "idle" } } }));
    const result = await createSessionService(makeClient()).statusAll();
    expect(result).toEqual({ sess_01: { type: "idle" } });
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/session/status" },
    });
  });

  it("promptAsync POSTs the parts body to the session", async () => {
    invokeMock.mockResolvedValue(httpResponse({ status: 204 }));
    await createSessionService(makeClient()).promptAsync("sess_01", {
      parts: [{ type: "text", text: "hello" }],
    });
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/session/sess_01/prompt_async",
        body: { parts: [{ type: "text", text: "hello" }] },
      },
    });
  });

  it("abort POSTs to the session abort endpoint", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: true }));
    const result = await createSessionService(makeClient()).abort("sess_01");
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/session/sess_01/abort" },
    });
  });

  it("shell POSTs the command + agent body to /session/{id}/shell", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { info: {}, parts: [] } }));
    await createSessionService(makeClient()).shell("sess_01", {
      command: "ls -la",
      agent: "build",
    });

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/session/sess_01/shell",
        body: { command: "ls -la", agent: "build" },
      },
    });
  });

  it("shell carries the optional model and an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { info: {}, parts: [] } }));
    await createSessionService(makeClient()).shell(
      "sess_01",
      { command: "git status", agent: "plan", model: { providerID: "openai", modelID: "gpt-5" } },
      "/mock/projects/opencode-demo",
    );

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/session/sess_01/shell",
        body: {
          command: "git status",
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5" },
        },
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("shell resolves the created assistant message info + parts", async () => {
    const body = {
      info: { id: "msg_asst_shell_1", sessionID: "sess_01", role: "assistant" },
      parts: [{ id: "prt_shell_1", type: "text", text: "$ ls\nout" }],
    };
    invokeMock.mockResolvedValue(httpResponse({ body }));
    await expect(
      createSessionService(makeClient()).shell("sess_01", { command: "ls", agent: "build" }),
    ).resolves.toEqual(body);
  });

  it("fork POSTs /session/{id}/fork with an empty body by default", async () => {
    invokeMock.mockResolvedValue(
      httpResponse({ body: { id: "sess_forked", parentID: "sess_01" } }),
    );
    const result = await createSessionService(makeClient()).fork("sess_01");
    expect(result.parentID).toBe("sess_01");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/session/sess_01/fork", body: {} },
    });
  });

  it("fork carries the messageID and an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "sess_forked" } }));
    await createSessionService(makeClient()).fork(
      "sess_01",
      "msg_02",
      "/mock/projects/opencode-demo",
    );
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/session/sess_01/fork",
        body: { messageID: "msg_02" },
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("revert POSTs the messageID body to /session/{id}/revert", async () => {
    invokeMock.mockResolvedValue(
      httpResponse({ body: { id: "sess_01", revert: { messageID: "msg_02" } } }),
    );
    const result = await createSessionService(makeClient()).revert("sess_01", "msg_02");
    expect(result.revert?.messageID).toBe("msg_02");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/session/sess_01/revert",
        body: { messageID: "msg_02" },
      },
    });
  });

  it("revert carries the optional partID and an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "sess_01" } }));
    await createSessionService(makeClient()).revert(
      "sess_01",
      "msg_02",
      "/mock/projects/opencode-demo",
    );
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/session/sess_01/revert",
        body: { messageID: "msg_02" },
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("unrevert POSTs /session/{id}/unrevert without a body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "sess_01" } }));
    const result = await createSessionService(makeClient()).unrevert("sess_01");
    expect(result.id).toBe("sess_01");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/session/sess_01/unrevert" },
    });
  });

  it("unrevert carries an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "sess_01" } }));
    await createSessionService(makeClient()).unrevert("sess_01", "/mock/projects/opencode-demo");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/session/sess_01/unrevert",
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("share POSTs /session/{id}/share without a body", async () => {
    invokeMock.mockResolvedValue(
      httpResponse({
        body: { id: "sess_01", share: { url: "https://share.opencode.dev/s/sess_01" } },
      }),
    );
    const result = await createSessionService(makeClient()).share("sess_01");
    expect(result.share?.url).toBe("https://share.opencode.dev/s/sess_01");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/session/sess_01/share" },
    });
  });

  it("share carries an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "sess_01" } }));
    await createSessionService(makeClient()).share("sess_01", "/mock/projects/opencode-demo");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/session/sess_01/share",
        query: { directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("unshare DELETEs /session/{id}/share and resolves the updated session", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "sess_01" } }));
    const result = await createSessionService(makeClient()).unshare("sess_01");
    expect(result.share).toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "DELETE", path: "/session/sess_01/share" },
    });
  });

  it("unshare carries an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { id: "sess_01" } }));
    await createSessionService(makeClient()).unshare("sess_01", "/mock/projects/opencode-demo");
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "DELETE",
        path: "/session/sess_01/share",
        query: { directory: "/mock/projects/opencode-demo" },
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
    const service = createSessionService(makeClient());
    await expect(service.get("sess_99")).rejects.toBeInstanceOf(ApiError);
    await expect(service.get("sess_99")).rejects.toMatchObject({
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
  const service = createSessionService(client);

  it("list returns session fixtures", async () => {
    const sessions = await service.list();
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].id).toBeTypeOf("string");
    expect(sessions[0].title).toBeTypeOf("string");
  });

  it("create honors title and parentID", async () => {
    const created = await service.create({ title: "Contract created", parentID: "sess_01" });
    expect(created.title).toBe("Contract created");
    expect(created.parentID).toBe("sess_01");
  });

  it("get returns the session detail", async () => {
    const session = await service.get("sess_01");
    expect(session.id).toBe("sess_01");
    expect(session.time.updated).toBeTypeOf("number");
  });

  it("update patches the title", async () => {
    const updated = await service.update("sess_01", { title: "Contract renamed" });
    expect(updated.id).toBe("sess_01");
    expect(updated.title).toBe("Contract renamed");
  });

  it("remove deletes the session", async () => {
    const removed = await service.remove("sess_02");
    expect(removed).toBe(true);
  });

  it("statusAll returns the status map", async () => {
    const statuses = await service.statusAll();
    expect(typeof statuses).toBe("object");
    expect(Object.keys(statuses).length).toBeGreaterThan(0);
    expect(["idle", "busy", "retry"]).toContain(statuses.sess_01.type);
  });

  it("promptAsync is accepted with 204", async () => {
    await expect(
      service.promptAsync("sess_01", { parts: [{ type: "text", text: "hi" }] }),
    ).resolves.toBeUndefined();
  });

  it("abort stops the session", async () => {
    const aborted = await service.abort("sess_01");
    expect(aborted).toBe(true);
  });

  it("shell runs a command and resolves the assistant message", async () => {
    const result = await service.shell("sess_01", {
      command: "ls -la",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
    });
    expect(result.info.role).toBe("assistant");
    expect(result.info.sessionID).toBe("sess_01");
    expect(Array.isArray(result.parts)).toBe(true);
  });

  it("fork creates a child session carrying the parent id", async () => {
    const child = await service.fork("sess_01");
    expect(child.id).toBeTypeOf("string");
    expect(child.parentID).toBe("sess_01");
    expect(child.time.updated).toBeTypeOf("number");
  });

  it("fork accepts a known messageID", async () => {
    const child = await service.fork("sess_01", "msg_02");
    expect(child.parentID).toBe("sess_01");
  });

  it("fork rejects an unknown messageID with a 400", async () => {
    await expect(service.fork("sess_01", "msg_nope")).rejects.toMatchObject({ status: 400 });
  });

  it("revert sets the revert point on the updated session", async () => {
    const updated = await service.revert("sess_01", "msg_02");
    expect(updated.id).toBe("sess_01");
    expect(updated.revert?.messageID).toBe("msg_02");
    expect(updated.time.updated).toBeTypeOf("number");
  });

  it("revert rejects an unknown messageID with a 400", async () => {
    await expect(service.revert("sess_01", "msg_nope")).rejects.toMatchObject({ status: 400 });
  });

  it("unrevert clears the revert marker", async () => {
    await service.revert("sess_01", "msg_02");
    const updated = await service.unrevert("sess_01");
    expect(updated.id).toBe("sess_01");
    expect(updated.revert).toBeUndefined();
  });

  it("share reports the updated session carrying the share URL", async () => {
    const updated = await service.share("sess_01");
    expect(updated.id).toBe("sess_01");
    expect(updated.share?.url).toBeTypeOf("string");
    expect(updated.time.updated).toBeTypeOf("number");
  });

  it("unshare clears the share marker", async () => {
    await service.share("sess_01");
    const updated = await service.unshare("sess_01");
    expect(updated.id).toBe("sess_01");
    expect(updated.share).toBeUndefined();
  });
});
