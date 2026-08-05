// L1 tests for the classified error copy (TASK-M1-09, i18n in TASK-M9-02):
// the errorTitleKey mapping matrix across every transport code (asserting
// both the returned i18n key AND its English resolution through useT) and
// the JSON-message reduction for detail lines.

import { describe, expect, it } from "vitest";
import { useT } from "../i18n/index.js";
import { ApiError, errorDetailMessage, errorTitleKey, isAuthError } from "./errors.js";

function error(
  status: number | undefined,
  code: string,
  message = "",
  retriable = false,
): ApiError {
  return new ApiError(status, code, message, retriable);
}

/** Resolves the classified key through the default (English) language. */
function titleOf(err: ApiError): string {
  const ref = errorTitleKey(err);
  return useT()(ref.key, ref.options ?? {});
}

describe("errorTitleKey mapping matrix", () => {
  it("maps 401 to the auth-required key and copy", () => {
    expect(errorTitleKey(error(401, "http"))).toEqual({ key: "errors:authRequired" });
    expect(titleOf(error(401, "http"))).toBe("Authentication required");
  });

  it("maps 429 to the rate-limit title", () => {
    expect(titleOf(error(429, "http"))).toBe("Rate limited — try again shortly");
  });

  it("classifies messages containing rate-limit hints", () => {
    expect(titleOf(error(undefined, "session", "provider: rate limit exceeded"))).toBe(
      "Rate limited — try again shortly",
    );
    expect(titleOf(error(undefined, "session", "HTTP 429 from provider"))).toBe(
      "Rate limited — try again shortly",
    );
  });

  it("does not classify unrelated messages as rate limits", () => {
    expect(titleOf(error(undefined, "session", "provider: boom"))).toBe("Request failed");
  });

  it("maps network failures to Cannot reach server", () => {
    expect(errorTitleKey(error(undefined, "network"))).toEqual({ key: "errors:networkTitle" });
    expect(titleOf(error(undefined, "network"))).toBe("Cannot reach server");
  });

  it("maps timeouts to Request timed out", () => {
    expect(titleOf(error(undefined, "timeout"))).toBe("Request timed out");
  });

  it("maps 5xx http errors to Server error", () => {
    expect(titleOf(error(500, "http"))).toBe("Server error");
    expect(titleOf(error(502, "http"))).toBe("Server error");
  });

  it("maps 4xx http errors to Request failed", () => {
    expect(titleOf(error(404, "http"))).toBe("Request failed");
  });

  it("maps invalid_url to Invalid server URL", () => {
    expect(titleOf(error(undefined, "invalid_url"))).toBe("Invalid server URL");
  });

  it("maps cancelled to Request cancelled", () => {
    expect(titleOf(error(undefined, "cancelled"))).toBe("Request cancelled");
  });

  it("maps invalid_response to Unexpected response format", () => {
    expect(titleOf(error(undefined, "invalid_response"))).toBe("Unexpected response format");
  });

  it("falls back to Request failed for unknown codes", () => {
    expect(titleOf(error(undefined, "unknown"))).toBe("Request failed");
    expect(titleOf(error(undefined, "persist"))).toBe("Request failed");
  });
});

describe("errorDetailMessage", () => {
  it("returns the raw message when present", () => {
    expect(errorDetailMessage(error(undefined, "network", "connection refused"))).toBe(
      "connection refused",
    );
  });

  it("reduces a JSON transport message to its error field", () => {
    expect(errorDetailMessage(error(401, "http", '{"error":"unauthorized"}'))).toBe("unauthorized");
  });

  it("reduces a JSON transport message to its message field", () => {
    expect(errorDetailMessage(error(500, "http", '{"message":"boom"}'))).toBe("boom");
  });

  it("keeps the raw message when the JSON has no string fields", () => {
    const message = '{"details":["x"]}';
    expect(errorDetailMessage(error(500, "http", message))).toBe(message);
  });

  it("keeps malformed JSON untouched", () => {
    expect(errorDetailMessage(error(500, "http", "{not json"))).toBe("{not json");
  });

  it("returns null when the message is empty", () => {
    expect(errorDetailMessage(error(undefined, "network"))).toBeNull();
  });
});

describe("isAuthError", () => {
  it("detects 401 status regardless of code", () => {
    expect(isAuthError(error(401, "http"))).toBe(true);
    expect(isAuthError(error(401, "unknown"))).toBe(true);
  });

  it("rejects other statuses and codes", () => {
    expect(isAuthError(error(500, "http"))).toBe(false);
    expect(isAuthError(error(undefined, "network"))).toBe(false);
  });
});
