import type { Express, Request, Response } from "express";
import type { Fixtures } from "./fixtures.js";
import { handleSSE } from "./sse.js";

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
// `/project/current` and `/session` are directory-aware and handled
// dynamically (see registerDynamic): they resolve the `directory` query so
// dual-project switching (TASK-M2-03) returns isolated data per context.
const P0_CORE_LOOP: Route[] = [
  { method: "get", path: "/global/health", operation: "global.health", fixture: "health" },
  { method: "get", path: "/project", operation: "project.list", fixture: "project.list" },
  { method: "get", path: "/path", operation: "path.get", fixture: "path" },
  // `/session/status` must precede `/session/:sessionID` (express matches in
  // registration order).
  {
    method: "get",
    path: "/session/status",
    operation: "session.status",
    fixture: "session.status",
  },
  {
    method: "get",
    path: "/session/:sessionID",
    operation: "session.get",
    fixture: "session.detail",
  },
  {
    method: "get",
    path: "/session/:sessionID/message/:messageID",
    operation: "session.message",
    fixture: "session.message",
  },
  {
    method: "get",
    path: "/session/:sessionID/todo",
    operation: "session.todo",
    fixture: "session.todo",
  },
];

// P1–P4 endpoints are intentionally not registered yet; they return 501.
const ROUTES: Route[] = [...P0_CORE_LOOP];

// SSE endpoints stream events; they are not part of the fixture table.
function registerSSE(app: Express): void {
  app.get("/event", (req, res) => handleSSE(req, res, { global: false }));
  app.get("/global/event", (req, res) => handleSSE(req, res, { global: true }));
}

interface BaseSession {
  projectID: string;
  directory: string;
  version: string;
  title: string;
  time: { created: number; updated: number };
}

// Deterministic base session derived from the session list fixture so the
// dynamic handlers stay coherent across fixture roots (mock + recorded).
function baseOf(fixtures: Fixtures): BaseSession {
  const sessions = fixtures["session.list"];
  const first = Array.isArray(sessions) ? (sessions[0] as Record<string, unknown>) : undefined;
  const time =
    typeof first?.time === "object" && first?.time !== null
      ? (first.time as Record<string, unknown>)
      : {};
  return {
    projectID: typeof first?.projectID === "string" ? first.projectID : "project-mock-1",
    directory:
      typeof first?.directory === "string" ? first.directory : "/mock/projects/opencode-demo",
    version: typeof first?.version === "string" ? first.version : "1.18.11",
    title: typeof first?.title === "string" ? first.title : "",
    time: {
      created: typeof time.created === "number" ? time.created : 1750000000000,
      updated: typeof time.updated === "number" ? time.updated : 1750000000000,
    },
  };
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

// Endpoints whose responses depend on the request body / params are handled
// imperatively; the declarative fixture table cannot express them.
function registerDynamic(app: Express, fixtures: Fixtures): void {
  const base = baseOf(fixtures);

  const LABS_DIRECTORY = "/mock/projects/opencode-labs";

  function queryString(req: Request, name: string): string | undefined {
    const value = req.query[name];
    return typeof value === "string" ? value : undefined;
  }

  // `/project/current` and `/session` resolve the `directory` query so
  // switching projects (TASK-M2-03) returns the target project's data.
  // Unknown directories fall back to the default (demo) context.
  function projectByDirectory(directory: string | undefined): Record<string, unknown> | undefined {
    if (directory === undefined) return undefined;
    const list = Array.isArray(fixtures["project.list"]) ? fixtures["project.list"] : [];
    return (list as Record<string, unknown>[]).find((p) => p.worktree === directory);
  }

  app.get("/project/current", (req, res) => {
    const byDirectory = projectByDirectory(queryString(req, "directory"));
    res.json(byDirectory ?? fixtures["project.current"]);
  });

  app.get("/session", (req, res) => {
    const directory = queryString(req, "directory");
    res.json(
      directory === LABS_DIRECTORY ? fixtures["session.list.labs"] : fixtures["session.list"],
    );
  });

  app.post("/session", (req, res) => {
    const { parentID, title } = (req.body ?? {}) as { parentID?: string; title?: string };
    const created: Record<string, unknown> = {
      id: "sess_created",
      slug: slugify(title ?? "untitled"),
      projectID: base.projectID,
      directory: base.directory,
      title: title ?? "",
      version: base.version,
      time: { created: base.time.updated, updated: base.time.updated },
    };
    if (parentID) created.parentID = parentID;
    res.json(created);
  });

  app.patch("/session/:sessionID", (req, res) => {
    const { title } = (req.body ?? {}) as { title?: string };
    const updated: Record<string, unknown> = {
      ...base,
      id: req.params.sessionID,
      time: { ...base.time, updated: base.time.updated + 1 },
    };
    if (title !== undefined) updated.title = title;
    res.json(updated);
  });

  app.delete("/session/:sessionID", (_req, res) => {
    res.json(true);
  });

  app.post("/session/:sessionID/prompt_async", (_req, res) => {
    res.status(204).end();
  });

  app.post("/session/:sessionID/abort", (_req, res) => {
    res.json(true);
  });

  // Messages honor the `limit`/`before` pagination params (TASK-M2-01 /
  // TASK-M3-05): the fixture list is chronological (oldest first), `limit`
  // without `before` serves the MOST RECENT page (last `limit` entries) and
  // `before` pages strictly older than the given message id (combined with
  // `limit`; unknown ids yield an empty array). The client opens the
  // transcript with the recent page and walks backwards with `before`.
  app.get("/session/:sessionID/message", (req, res) => {
    const messages = Array.isArray(fixtures["session.messages"])
      ? fixtures["session.messages"]
      : [];
    const limit = Number(req.query.limit);
    const before = queryString(req, "before");
    let window = messages;
    if (before !== undefined) {
      const index = messages.findIndex((m) => m.info?.id === before);
      window = index === -1 ? [] : messages.slice(0, index);
    }
    const sliced = Number.isInteger(limit) && limit > 0 ? window.slice(-limit) : window;
    res.json(sliced);
  });
}

export function registerRoutes(app: Express, fixtures: Fixtures): void {
  for (const route of ROUTES) {
    const handler = (_req: Request, res: Response): void => {
      res.json(fixtures[route.fixture]);
    };
    app[route.method](route.path, handler);
  }
  registerDynamic(app, fixtures);
  registerSSE(app);
}
