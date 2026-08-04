// L1 tests for the classified error copy (TASK-M1-09): the
// errorTitle/errorDetail mapping matrix across every transport code and the
// JSON-message reduction for detail lines.

import { describe, expect, it } from "vitest";
import { ApiError, errorDetail, errorTitle, isAuthError } from "./errors.js";

function error(
  status: number | undefined,
  code: string,
  message = "",
  retriable = false,
): ApiError {
  return new ApiError(status, code, message, retriable);
}

describe("errorTitle mapping matrix", () => {
  it("maps 401 to Authentication required", () => {
    expect(errorTitle(error(401, "http"))).toBe("Authentication required");
  });

  it("maps network failures to Cannot reach server", () => {
    expect(errorTitle(error(undefined, "network"))).toBe("Cannot reach server");
  });

  it("maps timeouts to Request timed out", () => {
    expect(errorTitle(error(undefined, "timeout"))).toBe("Request timed out");
  });

  it("maps 5xx http errors to Server error", () => {
    expect(errorTitle(error(500, "http"))).toBe("Server error");
    expect(errorTitle(error(502, "http"))).toBe("Server error");
  });

  it("maps 4xx http errors to Request failed", () => {
    expect(errorTitle(error(404, "http"))).toBe("Request failed");
  });

  it("maps invalid_url to Invalid server URL", () => {
    expect(errorTitle(error(undefined, "invalid_url"))).toBe("Invalid server URL");
  });

  it("maps cancelled to Request cancelled", () => {
    expect(errorTitle(error(undefined, "cancelled"))).toBe("Request cancelled");
  });

  it("maps invalid_response to Unexpected response format", () => {
    expect(errorTitle(error(undefined, "invalid_response"))).toBe("Unexpected response format");
  });

  it("falls back to Request failed for unknown codes", () => {
    expect(errorTitle(error(undefined, "unknown"))).toBe("Request failed");
    expect(errorTitle(error(undefined, "persist"))).toBe("Request failed");
  });
});

describe("errorDetail", () => {
  it("returns the raw message when present", () => {
    expect(errorDetail(error(undefined, "network", "connection refused"))).toBe(
      "connection refused",
    );
  });

  it("reduces a JSON transport message to its error field", () => {
    expect(errorDetail(error(401, "http", '{"error":"unauthorized"}'))).toBe("unauthorized");
  });

  it("reduces a JSON transport message to its message field", () => {
    expect(errorDetail(error(500, "http", '{"message":"boom"}'))).toBe("boom");
  });

  it("keeps the raw message when the JSON has no string fields", () => {
    const message = '{"details":["x"]}';
    expect(errorDetail(error(500, "http", message))).toBe(message);
  });

  it("keeps malformed JSON untouched", () => {
    expect(errorDetail(error(500, "http", "{not json"))).toBe("{not json");
  });

  it("falls back to the title when the message is empty", () => {
    expect(errorDetail(error(undefined, "network"))).toBe("Cannot reach server");
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
