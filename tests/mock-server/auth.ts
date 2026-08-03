import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Basic Auth middleware, mirroring the real `OPENCODE_SERVER_PASSWORD`
// behavior. Only installed when a password is configured at startup.
//
// Failing requests get 401 `{ error: "unauthorized" }` plus the
// `WWW-Authenticate: Basic` challenge header.

const UNAUTHORIZED = { error: "unauthorized" };

export function basicAuth(password: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!safeCredentials(req, password)) {
      res.set("WWW-Authenticate", 'Basic realm="opencode"');
      res.status(401).json(UNAUTHORIZED);
      return;
    }
    next();
  };
}

function safeCredentials(req: Request, password: string): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Basic ")) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return false;
  }

  // RFC 7617: userid:password. The username is ignored; only the password
  // is checked, matching the real server.
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  return timingSafeEqual(decoded.slice(separator + 1), password);
}

// Constant-time comparison; returns false early on length mismatch because
// crypto.timingSafeEqual throws when buffers differ in length.
function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}
