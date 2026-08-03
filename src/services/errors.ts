// Unified API error type (ADR-002): Rust serializes `ApiError` from the
// transport channel; the dev-only fetch transport produces the same shape.

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
