// Unified API error type (ADR-002): Rust serializes `ApiError` from the
// transport channel; the dev-only fetch transport produces the same shape.
//
// Classification (TASK-M1-09, i18n in TASK-M9-02): `errorTitleKey` returns
// an i18n key (+ interpolation options) instead of an English string — the
// copy lives in the i18n resources and renders through `t()`. The raw
// server message is NOT translatable copy; `errorDetailMessage` extracts it
// for the components to display verbatim (or fall back to the title).

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

/** An i18n reference for a classified error title: the resource key plus
 *  optional interpolation options, resolved by the caller with `t(...)`. */
export interface ErrorTitleRef {
  key: string;
  options?: Record<string, unknown>;
}

/**
 * Classified short headline for a connection failure as an i18n reference.
 * Status/code driven so the copy stays stable while the underlying message
 * varies by server; the caller renders it through `t(ref.key, ref.options)`.
 */
export function errorTitleKey(err: ApiError): ErrorTitleRef {
  if (err.status === 401) return { key: "errors:authRequired" };
  // Rate limits surface as 429 or as a message-level hint (TASK-M2-10).
  if (isRateLimitHint(err.status, err.message)) return { key: "errors:rateLimit" };
  switch (err.code) {
    case "network":
      return { key: "errors:networkTitle" };
    case "timeout":
      return { key: "errors:timeoutTitle" };
    case "invalid_url":
      return { key: "errors:invalidUrl" };
    case "cancelled":
      return { key: "errors:cancelled" };
    case "invalid_response":
      return { key: "errors:invalidResponse" };
    case "http":
      return err.status !== undefined && err.status >= 500
        ? { key: "errors:serverError" }
        : { key: "errors:requestFailed" };
    default:
      return { key: "errors:requestFailed" };
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
 * Detail line under the title: the raw server message when present (a JSON
 * body from the transport is reduced to its `error`/`message` field), or
 * null when there is nothing to show — the caller then falls back to the
 * classified title.
 */
export function errorDetailMessage(err: ApiError): string | null {
  return err.message ? detailMessage(err.message) : null;
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
