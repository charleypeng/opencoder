import type { NextFunction, Request, Response } from "express";

// Fault injection middleware.
//
// Query parameters (mirrors docs/testing.md §2.2):
//   ?__fail=500   respond immediately with `{ error: "<status> injected" }`
//   ?__slow=3000  delay the response by the given number of milliseconds
//
// Used to exercise retry / reconnect / timeout handling in clients.

const FAIL_RE = /^[3-5]\d{2}$/;
const SLOW_RE = /^\d+$/;

function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export function faultInjection(req: Request, res: Response, next: NextFunction): void {
  const fail = firstQueryValue(req.query["__fail"]);
  const slow = firstQueryValue(req.query["__slow"]);

  if (fail !== undefined && FAIL_RE.test(fail)) {
    res.status(Number(fail)).json({ error: `${fail} injected` });
    return;
  }

  if (slow !== undefined && SLOW_RE.test(slow)) {
    const ms = Number(slow);
    if (ms > 0) {
      setTimeout(next, ms);
      return;
    }
  }

  next();
}
