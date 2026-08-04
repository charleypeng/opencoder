// L1 tests for the VCS domain service (TASK-M4-01): exact invoke payload
// assembly per method and ApiError passthrough. The optional L3 contract
// block runs against a live mock server when MOCK_URL is set.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors.js";
import { ApiClient, fetchTransport, invokeTransport, type HttpResponse } from "./client.js";
import { createVcsService } from "./vcs.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body: undefined, bodyText: undefined, ...overrides };
}

function makeClient(): ApiClient {
  return new ApiClient(invokeTransport);
}

describe("createVcsService (invoke payload assembly)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("info GETs /vcs without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: {} }));
    await createVcsService(makeClient()).info();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/vcs" },
    });
  });

  it("info passes an explicit directory", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: {} }));
    await createVcsService(makeClient()).info("/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/vcs",
        query: { directory: "/mock/projects/opencode-labs" },
      },
    });
  });

  it("status GETs /vcs/status without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createVcsService(makeClient()).status();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/vcs/status" },
    });
  });

  it("diff defaults to the contract-required git mode", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createVcsService(makeClient()).diff();

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/vcs/diff", query: { mode: "git" } },
    });
  });

  it("diff passes mode, context and directory through", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createVcsService(makeClient()).diff({
      mode: "branch",
      context: 5,
      dir: "/mock/projects/opencode-demo",
    });

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/vcs/diff",
        query: { mode: "branch", context: 5, directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("diffRaw resolves the text/x-diff payload from bodyText", async () => {
    const raw = "diff --git a/x b/x\n";
    invokeMock.mockResolvedValue(httpResponse({ body: undefined, bodyText: raw }));

    await expect(createVcsService(makeClient()).diffRaw()).resolves.toBe(raw);
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/vcs/diff/raw" },
    });
  });

  it("diffRaw prefers a parsed string body over the JSON-quoted bodyText", async () => {
    const raw = "diff --git a/y b/y\n";
    // fetchTransport always sets bodyText (the quoted wire form); the parsed
    // string on body must win so the result is not JSON-encoded.
    invokeMock.mockResolvedValue(httpResponse({ body: raw, bodyText: JSON.stringify(raw) }));

    await expect(createVcsService(makeClient()).diffRaw()).resolves.toBe(raw);
  });

  it("diffRaw returns a raw string body when bodyText is absent", async () => {
    const raw = "diff --git a/y b/y\n";
    invokeMock.mockResolvedValue(httpResponse({ body: raw, bodyText: undefined }));

    await expect(createVcsService(makeClient()).diffRaw()).resolves.toBe(raw);
  });

  it("apply POSTs the patch body", async () => {
    const patch = "--- a/x\n+++ b/x\n";
    invokeMock.mockResolvedValue(httpResponse({ body: { applied: true } }));

    await expect(createVcsService(makeClient()).apply(patch)).resolves.toEqual({ applied: true });
    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "POST", path: "/vcs/apply", body: { patch } },
    });
  });

  it("apply passes an explicit directory alongside the body", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: { applied: true } }));
    await createVcsService(makeClient()).apply("patch", "/mock/projects/opencode-labs");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "POST",
        path: "/vcs/apply",
        query: { directory: "/mock/projects/opencode-labs" },
        body: { patch: "patch" },
      },
    });
  });

  it("sessionDiff GETs /session/{id}/diff without query by default", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createVcsService(makeClient()).sessionDiff("ses_01");

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: { method: "GET", path: "/session/ses_01/diff" },
    });
  });

  it("sessionDiff passes messageID and directory through", async () => {
    invokeMock.mockResolvedValue(httpResponse({ body: [] }));
    await createVcsService(makeClient()).sessionDiff(
      "ses_01",
      "msg_02",
      "/mock/projects/opencode-demo",
    );

    expect(invokeMock).toHaveBeenCalledWith("http_request", {
      request: {
        method: "GET",
        path: "/session/ses_01/diff",
        query: { messageID: "msg_02", directory: "/mock/projects/opencode-demo" },
      },
    });
  });

  it("passes ApiError rejections through unchanged", async () => {
    invokeMock.mockRejectedValue({
      status: 500,
      code: "http",
      message: "boom",
      retriable: true,
    });
    const service = createVcsService(makeClient());
    await expect(service.info()).rejects.toBeInstanceOf(ApiError);
    await expect(service.sessionDiff("ses_99")).rejects.toMatchObject({
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
  const service = createVcsService(client);

  it("info returns branch info", async () => {
    const info = await service.info();
    expect(info.branch).toBeTypeOf("string");
    expect(info.default_branch).toBeTypeOf("string");
  });

  it("status returns the change list", async () => {
    const entries = await service.status();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].file).toBeTypeOf("string");
    expect(["added", "deleted", "modified"]).toContain(entries[0].status);
    expect(entries[0].additions).toBeTypeOf("number");
    expect(entries[0].deletions).toBeTypeOf("number");
  });

  it("diff returns per-file patches", async () => {
    const diffs = await service.diff();
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs[0].file).toBeTypeOf("string");
    expect(diffs[0].patch).toBeTypeOf("string");
    expect(diffs[0].additions).toBeTypeOf("number");
    expect(diffs[0].deletions).toBeTypeOf("number");
  });

  it("diffRaw returns unified diff text", async () => {
    const raw = await service.diffRaw();
    expect(raw).toContain("diff --git");
  });

  it("apply resolves the applied result", async () => {
    const result = await service.apply("--- a/x\n+++ b/x\n");
    expect(result.applied).toBe(true);
  });

  it("sessionDiff returns SnapshotFileDiff entries", async () => {
    const diffs = await service.sessionDiff("ses_abc123");
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs[0].file).toBeTypeOf("string");
    expect(diffs[0].patch).toBeTypeOf("string");
    expect(diffs[0].additions).toBeTypeOf("number");
    expect(diffs[0].deletions).toBeTypeOf("number");
  });

  it("sessionDiff filters by messageID", async () => {
    const full = await service.sessionDiff("ses_abc123");
    const filtered = await service.sessionDiff("ses_abc123", "msg_02");
    expect(filtered.length).toBeLessThan(full.length);
    expect(filtered.length).toBeGreaterThan(0);
  });
});
