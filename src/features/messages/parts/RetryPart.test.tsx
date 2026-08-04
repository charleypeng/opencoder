// L2 tests for the retry notice (TASK-M3-04): RetryPart renders the system
// chip with the attempt count, the failure reason (danger styling for
// rate-limit errors, faint otherwise) and a countdown label that ticks once
// per second when `retryAt` is provided and falls back to a static
// "Retrying…" without timing data; the interval is cleaned up on dispose.
// Snapshots come from the all-parts fixture's retry part (prt_p8).

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { isRateLimitError, RetryPart } from "./RetryPart";
import type { RetryPartData } from "./RetryPart";
import allPartsFixtureJson from "../../../../tests/fixtures/message.stream.all-parts.json";

afterEach(() => {
  vi.useRealTimers();
});

function retryPart(overrides: Partial<RetryPartData> = {}): RetryPartData {
  return {
    id: "prt_retry",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "retry",
    attempt: 2,
    error: {
      name: "APIError",
      data: { message: "provider: rate limit exceeded", isRetryable: true },
    },
    time: { created: 1750000018000 },
    ...overrides,
  };
}

function errorWith(message: string, statusCode?: number): RetryPartData["error"] {
  return {
    name: "APIError",
    data: { message, isRetryable: true, ...(statusCode !== undefined ? { statusCode } : {}) },
  };
}

describe("isRateLimitError", () => {
  it("classifies 429 status codes and message hints as rate limits", () => {
    expect(isRateLimitError(errorWith("too many requests", 429))).toBe(true);
    expect(isRateLimitError(errorWith("rate limited by the model provider"))).toBe(true);
    expect(isRateLimitError(errorWith("quota exceeded (429)"))).toBe(true);
  });

  it("keeps unrelated errors unclassified", () => {
    expect(isRateLimitError(errorWith("context window exceeded"))).toBe(false);
    expect(isRateLimitError(errorWith("connection refused", 502))).toBe(false);
  });
});

describe("RetryPart", () => {
  it("renders the attempt count and the failure reason from the fixture part", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p8") as
      RetryPartData | undefined;
    expect(fixturePart).toBeDefined();
    render(() => <RetryPart part={fixturePart as RetryPartData} />);

    expect(screen.getByTestId("retry-part")).toHaveTextContent("Retrying (attempt 2)");
    expect(screen.getByTestId("retry-error")).toHaveTextContent(
      "rate limited by the model provider",
    );
  });

  it("styles rate-limit errors in danger and other errors faint", () => {
    const rateLimit = render(() => (
      <RetryPart part={retryPart({ error: errorWith("rate limit exceeded") })} />
    ));
    expect(screen.getByTestId("retry-error")).toHaveClass("text-danger");
    rateLimit.unmount();

    render(() => <RetryPart part={retryPart({ error: errorWith("context window exceeded") })} />);
    expect(screen.getByTestId("retry-error")).toHaveClass("text-fg-faint");
  });

  it("shows no error row when the error message is empty", () => {
    render(() => <RetryPart part={retryPart({ error: errorWith("") })} />);
    expect(screen.queryByTestId("retry-error")).not.toBeInTheDocument();
  });

  it("shows a static Retrying label without timing data", () => {
    render(() => <RetryPart part={retryPart()} />);
    expect(screen.getByTestId("retry-countdown")).toHaveTextContent("Retrying…");
  });

  it("ticks the next-attempt countdown down once per second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1750000018000));
    render(() => <RetryPart part={retryPart()} retryAt={1750000023000} />);
    expect(screen.getByTestId("retry-countdown")).toHaveTextContent("next attempt in 5s");

    vi.advanceTimersByTime(2000);
    expect(screen.getByTestId("retry-countdown")).toHaveTextContent("next attempt in 3s");
  });

  it("falls back to Retrying when the countdown reaches zero", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1750000018000));
    render(() => <RetryPart part={retryPart()} retryAt={1750000020000} />);
    expect(screen.getByTestId("retry-countdown")).toHaveTextContent("next attempt in 2s");

    vi.advanceTimersByTime(2500);
    expect(screen.getByTestId("retry-countdown")).toHaveTextContent("Retrying…");
  });

  it("cleans up the countdown interval on unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1750000018000));
    const { unmount } = render(() => <RetryPart part={retryPart()} retryAt={1750000023000} />);
    unmount();
    expect(() => vi.advanceTimersByTime(60000)).not.toThrow();
  });
});

describe("RetryPart snapshot", () => {
  it("matches the fixture's retry part", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p8") as
      RetryPartData | undefined;
    expect(fixturePart).toBeDefined();
    const { container } = render(() => <RetryPart part={fixturePart as RetryPartData} />);
    expect(container).toMatchSnapshot();
  });
});
