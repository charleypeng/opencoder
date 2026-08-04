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

// P2 — efficiency tools (M4): /find family. `/find` is handled dynamically
// (pattern filtering, TASK-M4-05) and `/find/file` / `/find/symbol` filter
// by query (TASK-M3-08 / TASK-M4-06).
const FIND_ROUTES: Route[] = [];

// P2 — efficiency tools (M4): /file family. The tree is a flat FileNode[]
// served declaratively; the viewer (M4-03) expands directories by re-listing
// with `path`, and `/file/content` / `/file/status` are static fixtures.
const FILE_ROUTES: Route[] = [
  { method: "get", path: "/file", operation: "file.list", fixture: "file.tree" },
  { method: "get", path: "/file/content", operation: "file.read", fixture: "file.content" },
  { method: "get", path: "/file/status", operation: "file.status", fixture: "file.status" },
];

// P2 — efficiency tools (M4): /vcs family. Branch info, status and per-file
// diffs are static fixtures; `/vcs/diff/raw` (text/x-diff), `/vcs/apply` and
// the messageID-filtered `/session/{id}/diff` are handled dynamically.
const VCS_ROUTES: Route[] = [
  { method: "get", path: "/vcs", operation: "vcs.get", fixture: "vcs" },
  { method: "get", path: "/vcs/status", operation: "vcs.status", fixture: "vcs.status" },
  { method: "get", path: "/vcs/diff", operation: "vcs.diff", fixture: "vcs.diff" },
];

// P3 — permissions (M5): the pending-request list is a static fixture; the
// reply endpoint is dynamic (body validation, TASK-M5-01).
const PERMISSION_ROUTES: Route[] = [
  { method: "get", path: "/permission", operation: "permission.list", fixture: "permission" },
];

// P3 — questions (M5): the pending-question list is a static fixture (one
// options question, one free-input question); the reply/reject endpoints
// are dynamic (body validation, TASK-M5-02).
const QUESTION_ROUTES: Route[] = [
  { method: "get", path: "/question", operation: "question.list", fixture: "question" },
];

const ROUTES: Route[] = [
  ...P0_CORE_LOOP,
  ...FIND_ROUTES,
  ...FILE_ROUTES,
  ...VCS_ROUTES,
  ...PERMISSION_ROUTES,
  ...QUESTION_ROUTES,
];

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

/** Escapes regex metacharacters so a literal pattern never miscompiles. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  // Fuzzy file search (TASK-M3-08): the fixture path list is filtered by a
  // case-insensitive substring match; an empty or missing query returns an
  // empty array (the composer never calls with one, but the contract holds).
  app.get("/find/file", (req, res) => {
    const query = queryString(req, "query");
    const files = Array.isArray(fixtures["find.file"]) ? (fixtures["find.file"] as string[]) : [];
    if (query === undefined || query === "") {
      res.json([]);
      return;
    }
    const needle = query.toLowerCase();
    res.json(files.filter((path) => path.toLowerCase().includes(needle)));
  });

  // Workspace symbol search (TASK-M4-06): the fixture symbol list is
  // filtered by a case-insensitive substring match on the symbol name; an
  // empty or missing query returns an empty array (same convention as
  // `/find/file`).
  app.get("/find/symbol", (req, res) => {
    const query = queryString(req, "query");
    const symbols = Array.isArray(fixtures["find.symbol"])
      ? (fixtures["find.symbol"] as { name?: unknown }[])
      : [];
    if (query === undefined || query === "") {
      res.json([]);
      return;
    }
    const needle = query.toLowerCase();
    res.json(
      symbols.filter((symbol) =>
        String(symbol.name ?? "")
          .toLowerCase()
          .includes(needle),
      ),
    );
  });

  // Full-text search (TASK-M4-05): the fixture match list is filtered by
  // the `pattern` query — a case-insensitive substring match, or a
  // regular expression when `regex=true`. The regex flag is a mock-only
  // extension: the 1.18.11 contract has no regex parameter, so a real
  // server always matches literally. An empty pattern or an invalid
  // regex yields an empty array (the "unknown id -> empty array"
  // convention).
  app.get("/find", (req, res) => {
    const pattern = queryString(req, "pattern");
    const matches = Array.isArray(fixtures["find"]) ? fixtures["find"] : [];
    if (pattern === undefined || pattern === "") {
      res.json([]);
      return;
    }
    let matcher: RegExp;
    try {
      matcher = new RegExp(
        queryString(req, "regex") === "true" ? pattern : escapeRegExp(pattern),
        "i",
      );
    } catch {
      res.json([]);
      return;
    }
    res.json(
      matches.filter((match) =>
        matcher.test(String((match as { lines?: { text?: unknown } }).lines?.text ?? "")),
      ),
    );
  });

  app.post("/session/:sessionID/abort", (_req, res) => {
    res.json(true);
  });

  // Raw working-tree diff (TASK-M4-01): the endpoint serves text/x-diff, so
  // the fixture string is sent as text with the proper content type instead
  // of being JSON-encoded.
  app.get("/vcs/diff/raw", (_req, res) => {
    res.type("text/x-diff; charset=utf-8").send(fixtures["vcs.diff.raw"]);
  });

  // Patch apply (TASK-M4-01): the mock always reports success.
  app.post("/vcs/apply", (_req, res) => {
    res.json({ applied: true });
  });

  // Session diff (TASK-M4-01): SnapshotFileDiff entries carry no message id,
  // so the optional messageID filter is modeled with a fixed subset — msg_02
  // covers the first two records, unknown ids yield an empty array (same
  // convention as the message `before` cursor).
  app.get("/session/:sessionID/diff", (req, res) => {
    const messageID = queryString(req, "messageID");
    const diffs = Array.isArray(fixtures["session.diff"]) ? fixtures["session.diff"] : [];
    if (messageID === undefined) {
      res.json(diffs);
    } else if (messageID === "msg_02") {
      res.json(diffs.slice(0, 2));
    } else {
      res.json([]);
    }
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

  // Message operations (TASK-M3-06): delete returns true; part PATCH echoes
  // the submitted Part with the path ids normalized onto it (the client
  // applies the response as the new part state), part DELETE returns true.
  app.delete("/session/:sessionID/message/:messageID", (_req, res) => {
    res.json(true);
  });

  app.patch("/session/:sessionID/message/:messageID/part/:partID", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({
      ...body,
      id: req.params.partID,
      sessionID: req.params.sessionID,
      messageID: req.params.messageID,
    });
  });

  app.delete("/session/:sessionID/message/:messageID/part/:partID", (_req, res) => {
    res.json(true);
  });

  // Permission reply (TASK-M5-01): accepts the schema's once/always/reject
  // values and reports success; an invalid reply is a 400 BadRequestError.
  // The `permission.replied` SSE event is streamed by the scenario scripts,
  // not emitted live here (the real server broadcasts it after processing).
  app.post("/permission/:requestID/reply", (req, res) => {
    const { reply } = (req.body ?? {}) as { reply?: unknown };
    if (!["once", "always", "reject"].includes(String(reply))) {
      res.status(400).json({ _tag: "BadRequestError", message: `invalid reply: ${reply}` });
      return;
    }
    res.json(true);
  });

  // Question reply (TASK-M5-02): accepts an `answers` array (one entry per
  // question, each an array of selected labels / the typed text) and
  // reports success; a missing or non-array payload is a 400 BadRequestError.
  // The `question.replied` SSE event is streamed by the scenario scripts,
  // not emitted live here (the real server broadcasts it after processing).
  app.post("/question/:requestID/reply", (req, res) => {
    const { answers } = (req.body ?? {}) as { answers?: unknown };
    if (!Array.isArray(answers) || answers.some((answer) => !Array.isArray(answer))) {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid answers" });
      return;
    }
    res.json(true);
  });

  // Question reject (TASK-M5-02): no body, always reports success.
  app.post("/question/:requestID/reject", (_req, res) => {
    res.json(true);
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
