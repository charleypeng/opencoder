import type { NextFunction, Request, Response } from "express";

// Dev-only CORS middleware (enabled with `mock:start --cors`).
//
// Allows the Tauri webview origins and the Vite dev server so the
// dev-only fetch transport and Playwright can talk to the mock server
// from the browser. The production path (Rust transport) never needs it.
// See docs/testing.md §2.2.

const ALLOWED_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
]);

const ALLOW_METHODS = "GET, POST, PATCH, PUT, DELETE, OPTIONS";
const ALLOW_HEADERS = "Authorization, Content-Type";

export function corsDev(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  if (origin !== undefined && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Methods", ALLOW_METHODS);
    res.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
    // Vary on Origin so caches keep per-origin responses separate.
    res.set("Vary", "Origin");
  }

  // Preflight requests never carry credentials; answer them directly so the
  // auth middleware does not reject them.
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
}
