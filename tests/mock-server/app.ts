import express from "express";
import type { Express } from "express";
import { basicAuth } from "./auth.js";
import { corsDev } from "./cors.js";
import { faultInjection } from "./faults.js";
import { loadFixtures } from "./fixtures.js";
import { registerRoutes } from "./routes.js";

// Assembles the express app (middleware + route table). Does not listen;
// that is the job of index.ts (CLI entry) or the self-test.

export interface MockServerOptions {
  // Dev-only CORS for the Tauri webview / Vite dev server origins.
  cors?: boolean;
  // When set, requires Basic Auth with this password (matching the real
  // OPENCODE_SERVER_PASSWORD behavior).
  authPassword?: string;
}

export function buildApp(options: MockServerOptions = {}): Express {
  const app = express();
  app.use(express.json());
  // OAuth token endpoints speak application/x-www-form-urlencoded
  // (TASK-UI-01); the Rust transport sends forms as urlencoded bodies.
  app.use(express.urlencoded({ extended: true }));

  const fixtures = loadFixtures();

  // CORS first so preflight OPTIONS never hits the auth middleware.
  if (options.cors) {
    app.use(corsDev);
  }
  if (options.authPassword !== undefined) {
    app.use(basicAuth(options.authPassword));
  }

  // Fault injection before the routes so `__fail`/`__slow` affect every
  // registered endpoint.
  app.use(faultInjection);

  registerRoutes(app, fixtures);

  // Catch-all: known-but-unimplemented and unknown endpoints get a 501 so
  // the client can distinguish "mock lacks this" from a server error.
  app.use((req, res) => {
    console.warn(`[mock] not implemented: ${req.method} ${req.originalUrl}`);
    res.status(501).json({ error: "not implemented" });
  });

  return app;
}
