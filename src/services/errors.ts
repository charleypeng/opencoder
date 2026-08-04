// Unified API error type (ADR-002): Rust serializes `ApiError` from the
// transport channel; the dev-only fetch transport produces the same shape.
//
// `errorTitle` / `errorDetail` centralize the classified user-facing copy
// (TASK-M1-09); the strings are English for now and move to i18n in M9.

export interface ApiErrorPayload {
  status?: number | null;
  code: string;
  message: string;
  retriable: boolean;
}

export class ApiError extends Error {
  readonly status?: number;
  readonly code: string;
  readonly retriable: boolean;

  constructor(status: number | undefined, code: string, message: string, retriable: boolean) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retriable = retriable;
  }

  /** Maps unknown rejection values (invoke errors, fetch errors) to ApiError. */
  static fromUnknown(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (isApiErrorPayload(err)) {
      return new ApiError(err.status ?? undefined, err.code, err.message, Boolean(err.retriable));
    }
    return new ApiError(undefined, "unknown", messageOf(err), false);
  }
}

function isApiErrorPayload(err: unknown): err is ApiErrorPayload {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { code?: unknown; message?: unknown };
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

/** True when the server rejected the request as unauthorized. */
export function isAuthError(err: ApiError): boolean {
  return err.status === 401;
}

/**
 * Classified short headline for a connection failure. Status/code driven so
 * the copy stays stable while the underlying message varies by server.
 */
export function errorTitle(err: ApiError): string {
  if (err.status === 401) return "Authentication required";
  // Rate limits surface as 429 or as a message-level hint (TASK-M2-10).
  if (isRateLimitHint(err.status, err.message)) return "Rate limited — try again shortly";
  switch (err.code) {
    case "network":
      return "Cannot reach server";
    case "timeout":
      return "Request timed out";
    case "invalid_url":
      return "Invalid server URL";
    case "cancelled":
      return "Request cancelled";
    case "invalid_response":
      return "Unexpected response format";
    case "http":
      return err.status !== undefined && err.status >= 500 ? "Server error" : "Request failed";
    default:
      return "Request failed";
  }
}

/**
 * True when a status/message pair is a provider/HTTP rate limit (429 or a
 * message-level hint). Shape-agnostic so both the transport ApiError and the
 * schema APIError parts classify the same way.
 */
export function isRateLimitHint(status: number | undefined, message: string | undefined): boolean {
  if (status === 429) return true;
  if (typeof message !== "string") return false;
  const normalized = message.toLowerCase();
  return normalized.includes("rate limit") || normalized.includes("429");
}

/**
 * Detail line under the title: the raw message when present (a JSON body
 * from the transport is reduced to its `error`/`message` field), otherwise
 * the title itself.
 */
export function errorDetail(err: ApiError): string {
  return err.message ? detailMessage(err.message) : errorTitle(err);
}

/** Extracts the human-readable part of a raw transport message. */
function detailMessage(message: string): string {
  if (!message.startsWith("{")) return message;
  try {
    const parsed = JSON.parse(message) as { error?: unknown; message?: unknown };
    const value = typeof parsed.error === "string" ? parsed.error : parsed.message;
    return typeof value === "string" && value.length > 0 ? value : message;
  } catch {
    return message;
  }
}
