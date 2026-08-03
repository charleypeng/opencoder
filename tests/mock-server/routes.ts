import type { Express, Request, Response } from "express";
import type { Fixtures } from "./fixtures.js";

// Declarative route table, grouped by the priority sections of
// docs/api-coverage.md. Each entry maps an OpenAPI endpoint to a fixture
// key. Endpoints that are not registered here fall through to the 501
// catch-all in app.ts, which logs the request.
//
// Note: register more specific paths before their parameterized siblings
// (e.g. `/session/status` before `/session/:sessionID`).

export interface Route {
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  // OpenAPI operation id (as referenced by docs/api-coverage.md) — used for
  // coverage logging.
  operation: string;
  // Fixture key from tests/mock-server/fixtures/index.json.
  fixture: string;
}

// P0 — core loop (M1–M2): health, project, session family.
const P0_CORE_LOOP: Route[] = [
  { method: "get", path: "/global/health", operation: "global.health", fixture: "health" },
  { method: "get", path: "/project", operation: "project.list", fixture: "project.list" },
  { method: "get", path: "/project/current", operation: "project.current", fixture: "project.current" },
  { method: "get", path: "/session", operation: "session.list", fixture: "session.list" },
  { method: "get", path: "/session/:sessionID", operation: "session.get", fixture: "session.detail" },
  { method: "get", path: "/session/:sessionID/message", operation: "session.messages", fixture: "session.messages" },
  { method: "get", path: "/session/:sessionID/message/:messageID", operation: "session.message", fixture: "session.message" },
  { method: "get", path: "/session/:sessionID/todo", operation: "session.todo", fixture: "session.todo" },
];

// P1–P4 endpoints are intentionally not registered yet; they return 501.
const ROUTES: Route[] = [...P0_CORE_LOOP];

export function registerRoutes(app: Express, fixtures: Fixtures): void {
  for (const route of ROUTES) {
    const handler = (_req: Request, res: Response): void => {
      res.json(fixtures[route.fixture]);
    };
    app[route.method](route.path, handler);
  }
}
