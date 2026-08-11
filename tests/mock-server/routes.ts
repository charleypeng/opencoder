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
// `/file` itself is handled DYNAMICALLY (see registerDynamic): the real
// server requires the `path` query (openapi required), so the mock answers
// the same 400 BadRequest when it is missing — the client must always send
// it (the empty string for the root listing).
const FILE_ROUTES: Route[] = [
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

// P3 — commands (M5): the available slash-command list is a static fixture;
// running one is dynamic (body validation, TASK-M5-03).
const COMMAND_ROUTES: Route[] = [
  { method: "get", path: "/command", operation: "command.list", fixture: "command" },
];

// P3 — models (M5): the agent catalog is a static fixture (build/plan plus
// a hidden architect, TASK-M5-04).
const AGENT_ROUTES: Route[] = [
  { method: "get", path: "/agent", operation: "app.agents", fixture: "agent" },
];

// P3 — skills (M5): the skill list is a static fixture (three visible
// skills, TASK-M5-08). The 1.18.11 schema has no hidden flag — hidden
// skills are filtered server-side and simply never reach this list.
const SKILL_ROUTES: Route[] = [
  { method: "get", path: "/skill", operation: "app.skills", fixture: "skill" },
];

// P3 — models (M5): the provider catalog with per-provider default models
// and connected ids (TASK-M5-05); /config/providers carries the config
// default record the picker's Default marker follows. TASK-M5-06 adds the
// per-provider auth methods (GET /provider/auth) driving the settings
// forms; the credential endpoints PUT/DELETE /auth/{providerID} are
// dynamic (body validation, see registerDynamic).
//
// `/provider` itself is NOT in this table: TASK-S1-04 made it dynamic so
// the catalog merges providers added via PATCH /global/config (see
// registerDynamic, provider catalog).
const PROVIDER_ROUTES: Route[] = [
  {
    method: "get",
    path: "/config/providers",
    operation: "config.providers",
    fixture: "config.providers",
  },
  { method: "get", path: "/provider/auth", operation: "provider.auth", fixture: "provider.auth" },
];

// P3 — PTY family (M6): the session list and the shell catalog are static
// fixtures; the per-pty endpoints, the connect-token exchange and the
// connect upgrade are dynamic (see registerDynamic — the connect endpoint
// answers 426 because express cannot upgrade to WebSocket natively, see
// docs/api-coverage.md §4).
const PTY_ROUTES: Route[] = [
  { method: "get", path: "/pty", operation: "pty.list", fixture: "pty" },
  { method: "get", path: "/pty/shells", operation: "pty.shells", fixture: "pty.shells" },
];

// P4 — status bar (M9): LSP and formatter status are static fixtures; the
// status-bar chips fetch them on mount and the client refetches GET /lsp
// on every `lsp.updated` SSE event (whose payload is empty — the mock
// replays the same fixture).
const STATUS_BAR_ROUTES: Route[] = [
  { method: "get", path: "/lsp", operation: "lsp.status", fixture: "lsp.status" },
  { method: "get", path: "/formatter", operation: "formatter.status", fixture: "formatter" },
];

const ROUTES: Route[] = [
  ...P0_CORE_LOOP,
  ...FIND_ROUTES,
  ...FILE_ROUTES,
  ...VCS_ROUTES,
  ...PERMISSION_ROUTES,
  ...QUESTION_ROUTES,
  ...COMMAND_ROUTES,
  ...AGENT_ROUTES,
  ...SKILL_ROUTES,
  ...PROVIDER_ROUTES,
  ...PTY_ROUTES,
  ...STATUS_BAR_ROUTES,
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
    // The filepicker dialog creates sessions in a chosen project
    // directory (TASK-UI-01): the query parameter is echoed on the
    // created session.
    const directory = (req.query.directory as string | undefined) ?? base.directory;
    const created: Record<string, unknown> = {
      id: "sess_created",
      slug: slugify(title ?? "untitled"),
      projectID: base.projectID,
      directory,
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

  // Session fork (TASK-M6-03): accepts the schema's optional { messageID }
  // body and reports the created child session with parentID set to the
  // forked session. A present messageID must be a known fixture message
  // (the fork point must exist) — anything else is a 400 BadRequestError.
  app.post("/session/:sessionID/fork", (req, res) => {
    const { messageID } = (req.body ?? {}) as { messageID?: unknown };
    if (typeof messageID === "string") {
      const messages = Array.isArray(fixtures["session.messages"])
        ? fixtures["session.messages"]
        : [];
      const known = messages.some((m) => m?.info?.id === messageID);
      if (!known) {
        res
          .status(400)
          .json({ _tag: "BadRequestError", message: `unknown messageID: ${messageID}` });
        return;
      }
    } else if (messageID !== undefined) {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid fork payload" });
      return;
    }
    const updated = base.time.updated + 1;
    res.json({
      id: "sess_forked",
      slug: "forked",
      projectID: base.projectID,
      directory: base.directory,
      parentID: req.params.sessionID,
      title: `Fork of ${base.title}`,
      version: base.version,
      time: { created: updated, updated },
    });
  });

  // Session children (TASK-M6-07): the direct children of a session — the
  // fixture sessions carrying the parent id, in fixture order (a multi-level
  // tree: sess_01 → sess_02 → sess_03 → sess_04). Unknown sessions are a
  // 404 NotFoundError (contract).
  app.get("/session/:sessionID/children", (req, res) => {
    const sessions = Array.isArray(fixtures["session.list"])
      ? (fixtures["session.list"] as Record<string, unknown>[])
      : [];
    const known = sessions.some((s) => s?.id === req.params.sessionID);
    if (!known) {
      res.status(404).json({
        _tag: "NotFoundError",
        message: `session ${req.params.sessionID} not found`,
      });
      return;
    }
    res.json(sessions.filter((s) => s?.parentID === req.params.sessionID));
  });

  // Session sync message (TASK-M6-07): the same part validation as
  // prompt_async, but the endpoint waits for the full reply — it reports
  // the created assistant message ({ info, parts }) directly, like shell.
  app.post("/session/:sessionID/message", (req, res) => {
    const { parts } = (req.body ?? {}) as { parts?: unknown };
    if (!Array.isArray(parts) || parts.some((part) => !isValidPartInput(part))) {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid prompt payload" });
      return;
    }
    res.json({
      info: {
        id: "msg_asst_sync",
        sessionID: req.params.sessionID,
        role: "assistant",
        time: { created: base.time.updated },
        parentID: "msg_user_sync",
        modelID: "gpt-5",
        providerID: "openai",
        mode: "primary",
        agent: "build",
        path: { cwd: base.directory, root: base.directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          id: "prt_sync",
          sessionID: req.params.sessionID,
          messageID: "msg_asst_sync",
          type: "text",
          text: "(mock sync reply)",
        },
      ],
    });
  });

  // Session revert (TASK-M6-04): accepts the schema's { messageID } body
  // and reports the updated session carrying the `revert` marker (the
  // revert point). A missing/malformed messageID or one that is not a
  // known fixture message is a 400 BadRequestError.
  app.post("/session/:sessionID/revert", (req, res) => {
    const { messageID } = (req.body ?? {}) as { messageID?: unknown };
    if (typeof messageID !== "string") {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid revert payload" });
      return;
    }
    const messages = Array.isArray(fixtures["session.messages"])
      ? fixtures["session.messages"]
      : [];
    const known = messages.some((m) => m?.info?.id === messageID);
    if (!known) {
      res.status(400).json({ _tag: "BadRequestError", message: `unknown messageID: ${messageID}` });
      return;
    }
    res.json({
      ...base,
      id: req.params.sessionID,
      time: { ...base.time, updated: base.time.updated + 1 },
      revert: { messageID },
    });
  });

  // Session unrevert (TASK-M6-04): reports the updated session without
  // the revert marker (all previously reverted messages restored).
  app.post("/session/:sessionID/unrevert", (req, res) => {
    res.json({
      ...base,
      id: req.params.sessionID,
      time: { ...base.time, updated: base.time.updated + 1 },
    });
  });

  // Session share (TASK-M6-05): no body per the contract — reports the
  // updated session carrying the `share` marker with the shareable URL.
  app.post("/session/:sessionID/share", (req, res) => {
    res.json({
      ...base,
      id: req.params.sessionID,
      time: { ...base.time, updated: base.time.updated + 1 },
      share: { url: `https://share.opencode.dev/s/${req.params.sessionID}` },
    });
  });

  // Session unshare (TASK-M6-05): reports the updated session without the
  // share marker (the link is revoked, the session is private again).
  app.delete("/session/:sessionID/share", (req, res) => {
    res.json({
      ...base,
      id: req.params.sessionID,
      time: { ...base.time, updated: base.time.updated + 1 },
    });
  });

  // Session summarize (TASK-M6-06): accepts the schema's { providerID,
  // modelID, auto? } body — both strings required, and the pair must be a
  // known provider/model from the catalog fixture (anything else is a 400
  // BadRequestError) — and reports success as a plain boolean.
  app.post("/session/:sessionID/summarize", (req, res) => {
    const { providerID, modelID } = (req.body ?? {}) as { providerID?: unknown; modelID?: unknown };
    if (typeof providerID !== "string" || typeof modelID !== "string") {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid summarize payload" });
      return;
    }
    const catalog = fixtures["provider"] as Record<string, unknown> | undefined;
    const providers = Array.isArray(catalog?.all) ? (catalog.all as Record<string, unknown>[]) : [];
    const known = providers.some((provider) => {
      if (provider?.id !== providerID) return false;
      const models = provider.models;
      return (
        typeof models === "object" &&
        models !== null &&
        (models as Record<string, unknown>)[modelID] !== undefined
      );
    });
    if (!known) {
      res
        .status(400)
        .json({ _tag: "BadRequestError", message: `unknown model: ${providerID}/${modelID}` });
      return;
    }
    res.json(true);
  });

  // Session init (TASK-M6-06): accepts the schema's { modelID, providerID,
  // messageID } body — all three required; the provider/model must be a
  // known catalog pair and the messageID a known fixture message (anything
  // else is a 400 BadRequestError) — and reports success as a plain boolean.
  app.post("/session/:sessionID/init", (req, res) => {
    const { providerID, modelID, messageID } = (req.body ?? {}) as {
      providerID?: unknown;
      modelID?: unknown;
      messageID?: unknown;
    };
    if (
      typeof providerID !== "string" ||
      typeof modelID !== "string" ||
      typeof messageID !== "string"
    ) {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid init payload" });
      return;
    }
    const messages = Array.isArray(fixtures["session.messages"])
      ? fixtures["session.messages"]
      : [];
    const knownMessage = messages.some((m) => m?.info?.id === messageID);
    if (!knownMessage) {
      res.status(400).json({ _tag: "BadRequestError", message: `unknown messageID: ${messageID}` });
      return;
    }
    res.json(true);
  });

  // Prompt send (TASK-M2-08): always 204. TASK-M5-08 validates the part
  // array shape so the `@skillName` reference flow is exercised — accepted
  // types are the ones the composer actually sends: text (with a string
  // text), file (with a string filename) and agent (with a string name —
  // the AgentPartInput the server would echo for an `@skill` mention).
  function isValidPartInput(part: unknown): boolean {
    if (typeof part !== "object" || part === null) return false;
    const { type } = part as { type?: unknown };
    if (type === "text") return typeof (part as { text?: unknown }).text === "string";
    if (type === "file") return typeof (part as { filename?: unknown }).filename === "string";
    if (type === "agent") return typeof (part as { name?: unknown }).name === "string";
    return false;
  }

  app.post("/session/:sessionID/prompt_async", (req, res) => {
    const { parts } = (req.body ?? {}) as { parts?: unknown };
    if (!Array.isArray(parts) || parts.some((part) => !isValidPartInput(part))) {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid prompt payload" });
      return;
    }
    res.status(204).end();
  });

  // Shell run (TASK-M5-08): accepts the schema's { command, agent, model? }
  // body and reports the created assistant message (info + parts) directly
  // — the endpoint is synchronous, unlike prompt_async. A payload missing
  // either required string is a 400 BadRequestError; a present model must
  // carry string providerID/modelID.
  app.post("/session/:sessionID/shell", (req, res) => {
    const { command, agent, model } = (req.body ?? {}) as {
      command?: unknown;
      agent?: unknown;
      model?: unknown;
    };
    const validModel =
      model === undefined ||
      (typeof model === "object" &&
        model !== null &&
        typeof (model as { providerID?: unknown }).providerID === "string" &&
        typeof (model as { modelID?: unknown }).modelID === "string");
    if (
      typeof command !== "string" ||
      command === "" ||
      typeof agent !== "string" ||
      agent === "" ||
      !validModel
    ) {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid shell payload" });
      return;
    }
    res.json({
      info: {
        id: `msg_asst_shell_${command}`,
        sessionID: req.params.sessionID,
        role: "assistant",
        time: { created: base.time.updated },
        parentID: `msg_user_shell_${command}`,
        modelID: "gpt-5",
        providerID: "openai",
        mode: "primary",
        agent,
        path: { cwd: base.directory, root: base.directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          id: `prt_shell_${command}`,
          sessionID: req.params.sessionID,
          messageID: `msg_asst_shell_${command}`,
          type: "text",
          text: `$ ${command}\n(mock shell output)`,
        },
      ],
    });
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

  // File tree (TASK-M4-02): mirrors the real server's contract — `path` is a
  // REQUIRED query (openapi file.list). The root listing uses the empty
  // string; a missing key answers the same 400 BadRequest as opencode
  // (previously the mock served the fixture unconditionally, hiding client
  // bugs like the FileTree root load that omitted the key). The listing is
  // filtered to the DIRECT children of the requested directory (the real
  // server lists one level, not the whole tree), workspace-root-relative
  // paths are accepted for absolute requests inside the workspace, and
  // requests outside the workspace die like the real server's
  // "Path escapes the location".
  //
  // The `directory` query routes the request to that directory's OWN
  // context (workspace-routing on the real server). The add-directory
  // picker browses the filesystem root through it, so absolute directories
  // outside the workspace are served from the fixed ROOT_BROWSE table.
  const WORKSPACE_ROOT = "/mock/projects/opencode-demo";
  const ROOT_BROWSE: Record<string, string[]> = {
    "/": ["Volumes", "Users", "Applications"],
    "/Volumes": ["data", "Photos"],
    "/Volumes/data": ["project-a", "project-b"],
  };
  app.get("/file", (req, res) => {
    const raw = queryString(req, "path");
    if (raw === undefined) {
      res
        .status(400)
        .json({ _tag: "BadRequestError", message: 'Missing key\n at ["path"]', kind: "Query" });
      return;
    }
    // Absolute paths inside the workspace resolve to their workspace-
    // relative form (the real server answers root-relative paths for both
    // relative and absolute requests); anything outside escapes.
    const stripped = raw.replace(/[\\/]+$/, "");
    const directory = queryString(req, "directory");
    if (directory === undefined || directory === WORKSPACE_ROOT) {
      let relative = stripped;
      if (stripped.startsWith(WORKSPACE_ROOT)) {
        relative = stripped.slice(WORKSPACE_ROOT.length).replace(/^[/\\]/, "");
      } else if (stripped.startsWith("/") || /^[A-Za-z]:[\\/]/.test(stripped)) {
        res.status(500).json({ _tag: "InternalServerError", message: "Path escapes the location" });
        return;
      }
      const nodes = Array.isArray(fixtures["file.tree"]) ? fixtures["file.tree"] : [];
      // Direct children: the entry's parent directory equals the requested
      // path (directory entries carry a trailing separator — strip it).
      const children = (nodes as { path?: string }[]).filter((entry) => {
        const entryPath = (entry.path ?? "").replace(/[\\/]+$/, "");
        const idx = Math.max(entryPath.lastIndexOf("/"), entryPath.lastIndexOf("\\"));
        return (idx === -1 ? "" : entryPath.slice(0, idx)) === relative;
      });
      res.json(children);
      return;
    }
    // Root-browse context: known directories list their subfolders; the
    // `path` resolves inside the directory context like on the real server.
    // The filesystem root is "/" — it must not be stripped of its slash.
    const base = directory === "/" ? "/" : directory.replace(/[\\/]+$/, "");
    const target = stripped === "" ? base : `${base}/${stripped}`;
    const names = ROOT_BROWSE[target];
    if (names === undefined) {
      res.json([]);
      return;
    }
    res.json(
      names.map((name) => ({
        name,
        path: `${name}/`,
        absolute: `${target}/${name}`.replace(/\/+/g, "/"),
        type: "directory",
        ignored: false,
      })),
    );
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
  // The rich session (ses_rich_01, added for chat-UI visual verification)
  // serves the 100+ message fixture exercising every part type; all other
  // sessions keep the compact fixture.
  app.get("/session/:sessionID/message", (req, res) => {
    const key =
      req.params.sessionID === "ses_rich_01" ? "session.messages.rich" : "session.messages";
    const messages = Array.isArray(fixtures[key]) ? fixtures[key] : [];
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

  // Command run (TASK-M5-03): accepts the schema's { command, arguments }
  // body and reports the created assistant message (info + parts; the real
  // reply then streams in over SSE). A payload missing either string is a
  // 400 BadRequestError.
  app.post("/session/:sessionID/command", (req, res) => {
    const { command, arguments: args } = (req.body ?? {}) as {
      command?: unknown;
      arguments?: unknown;
    };
    if (typeof command !== "string" || command === "" || typeof args !== "string") {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid command payload" });
      return;
    }
    res.json({
      info: {
        id: `msg_asst_cmd_${command}`,
        sessionID: req.params.sessionID,
        role: "assistant",
        time: { created: base.time.updated },
        parentID: `msg_user_${command}`,
        modelID: "gpt-5",
        providerID: "openai",
        mode: "primary",
        agent: "build",
        path: { cwd: base.directory, root: base.directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [],
    });
  });

  // Provider API key set (TASK-M5-06): accepts the schema's ApiAuth body
  // ({ type: "api", key }) and reports success; the real server then
  // probes the credentials and the connected state moves with the next
  // GET /provider. A payload missing type "api" + a string key is a 400
  // BadRequestError (the OAuth form lands with TASK-M5-07).
  app.put("/auth/:providerID", (req, res) => {
    const body = (req.body ?? {}) as { type?: unknown; key?: unknown };
    if (body.type !== "api" || typeof body.key !== "string" || body.key === "") {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid auth payload" });
      return;
    }
    res.json(true);
  });

  // Provider API key remove (TASK-M5-06): no body, always reports success.
  app.delete("/auth/:providerID", (_req, res) => {
    res.json(true);
  });

  // Provider OAuth flow (TASK-M5-07): `authorize` creates a pending
  // session and returns the browser URL (with a per-session state), the
  // flow kind (auto | code, per provider auth method) and instructions;
  // the returned URL itself (GET /oauth/authorize) simulates the browser
  // round-trip — visiting it completes the pending session, mirroring the
  // real server's local callback listener; the callback endpoint validates
  // a submitted code (code flow, fixed mock code) or reports whether the
  // auto flow completed. The auto-mode poll body `{ method, poll: true }`
  // is a mock extension: the 1.18.11 contract has no status endpoint, so
  // the client polls the callback (documented in docs/api-coverage.md §5).
  const OAUTH_FLOWS: Record<string, string[]> = { azure: ["auto"], google: ["code"] };
  const MOCK_OAUTH_CODE = "mock-oauth-code";
  interface OAuthSession {
    providerID: string;
    methodIndex: number;
    state: string;
    completed: boolean;
  }
  const oauthSessions: OAuthSession[] = [];
  let oauthSequence = 0;

  app.post("/provider/:providerID/oauth/authorize", (req, res) => {
    const { providerID } = req.params;
    const { method } = (req.body ?? {}) as { method?: unknown };
    const flows = OAUTH_FLOWS[providerID] ?? [];
    if (!Number.isInteger(method) || (method as number) < 0 || (method as number) >= flows.length) {
      res.status(400).json({ _tag: "BadRequestError", message: `invalid oauth method: ${method}` });
      return;
    }
    oauthSequence += 1;
    const state = `oauth_state_${oauthSequence}`;
    oauthSessions.push({
      providerID,
      methodIndex: method as number,
      state,
      completed: false,
    });
    res.json({
      url: `${req.protocol}://${req.get("host")}/oauth/authorize?state=${state}`,
      method: flows[method as number],
      instructions: "Complete the authorization in the opened browser window, then return here.",
    });
  });

  // The browser page the authorize URL points at: visiting it completes
  // the pending session (the real server's local callback listener does
  // this automatically when the browser redirects back).
  app.get("/oauth/authorize", (req, res) => {
    const state = queryString(req, "state");
    const session = oauthSessions.findLast((s) => s.state === state);
    if (session !== undefined) session.completed = true;
    res
      .type("text/html")
      .send(
        "<html><body><h1>Authorization complete — you can close this window.</h1></body></html>",
      );
  });

  app.post("/provider/:providerID/oauth/callback", (req, res) => {
    const { providerID } = req.params;
    const body = (req.body ?? {}) as { method?: unknown; code?: unknown; poll?: unknown };
    const method = body.method;
    if (!Number.isInteger(method)) {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid oauth callback payload" });
      return;
    }
    const latest = oauthSessions.findLast(
      (s) => s.providerID === providerID && s.methodIndex === method,
    );
    // Code flow: a submitted code must match the fixed mock code; a valid
    // code completes the pending session (the real server exchanges it
    // with the provider).
    if (typeof body.code === "string" && body.code !== "") {
      if (body.code !== MOCK_OAUTH_CODE) {
        res
          .status(400)
          .json({ _tag: "BadRequestError", message: `invalid oauth code: ${body.code}` });
        return;
      }
      if (latest !== undefined) latest.completed = true;
      res.json(true);
      return;
    }
    // Auto flow poll (mock extension): report whether the flow completed.
    res.json(latest?.completed === true);
  });

  // ---- TASK-M6-01: PTY family (list/shells are declarative fixtures) ----

  // A pty entry from the fixture list, so dynamic handlers stay coherent
  // with the recorded fixture root.
  function ptyOf(id: string): Record<string, unknown> | undefined {
    const list = Array.isArray(fixtures["pty"]) ? fixtures["pty"] : [];
    return (list as Record<string, unknown>[]).find((pty) => pty?.id === id);
  }

  let ptySequence = 0;

  // Create (TASK-M6-01): the schema's { command, args, cwd, title, env } body
  // is optional throughout — a bare POST creates the default shell. The
  // response is a running Pty.
  app.post("/pty", (req, res) => {
    const body = (req.body ?? {}) as {
      command?: unknown;
      args?: unknown;
      cwd?: unknown;
      title?: unknown;
    };
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid pty payload" });
      return;
    }
    ptySequence += 1;
    const command = typeof body.command === "string" ? body.command : "sh";
    const created: Record<string, unknown> = {
      id: `pty_created_${ptySequence}`,
      title: typeof body.title === "string" ? body.title : command,
      command,
      args: Array.isArray(body.args) ? body.args.filter((a) => typeof a === "string") : [],
      cwd: typeof body.cwd === "string" ? body.cwd : base.directory,
      status: "running",
      pid: 42000 + ptySequence,
    };
    res.json(created);
  });

  // Get: serve the fixture entry for the id, unknown ids are a 404
  // PtyNotFoundError (contract shape { _tag, ptyID, message }).
  app.get("/pty/:ptyID", (req, res) => {
    const pty = ptyOf(req.params.ptyID);
    if (pty === undefined) {
      res.status(404).json({
        _tag: "PtyNotFoundError",
        ptyID: req.params.ptyID,
        message: `pty ${req.params.ptyID} not found`,
      });
      return;
    }
    res.json(pty);
  });

  // Update (TASK-M6-01): accepts { title?, size?: { rows, cols } } — the
  // resize channel of the PTY protocol (contract; not a WebSocket frame).
  // A malformed size is a 400, unknown ids a 404.
  app.put("/pty/:ptyID", (req, res) => {
    const pty = ptyOf(req.params.ptyID);
    if (pty === undefined) {
      res.status(404).json({
        _tag: "PtyNotFoundError",
        ptyID: req.params.ptyID,
        message: `pty ${req.params.ptyID} not found`,
      });
      return;
    }
    const body = (req.body ?? {}) as { title?: unknown; size?: unknown };
    const size = body.size;
    if (size !== undefined) {
      const rows = (size as { rows?: unknown })?.rows;
      const cols = (size as { cols?: unknown })?.cols;
      if (
        typeof rows !== "number" ||
        !Number.isInteger(rows) ||
        rows <= 0 ||
        typeof cols !== "number" ||
        !Number.isInteger(cols) ||
        cols <= 0
      ) {
        res.status(400).json({ _tag: "BadRequestError", message: "invalid pty size" });
        return;
      }
    }
    const updated: Record<string, unknown> = { ...pty, id: req.params.ptyID };
    if (typeof body.title === "string") updated.title = body.title;
    res.json(updated);
  });

  // Remove: always reports success (like the session delete).
  app.delete("/pty/:ptyID", (_req, res) => {
    res.json(true);
  });

  // Connect token (TASK-M6-01): returns the PtyTicketConnectToken the Rust
  // transport exchanges before opening the WebSocket channel.
  app.post("/pty/:ptyID/connect-token", (req, res) => {
    res.json({ ticket: `mock-ticket-${req.params.ptyID}`, expires_in: 60 });
  });

  // Connect (TASK-M6-01): the contract documents this endpoint as a plain
  // HTTP boolean, but the real server upgrades it to a WebSocket carrying
  // the connect ticket. express cannot upgrade natively, so the mock
  // answers 426 Upgrade Required with a JSON note — the WS data channel is
  // simulated by the standalone ws-echo.mjs server (docs/tasks/M6.md
  // appendix, contract-based verification).
  app.get("/pty/:ptyID/connect", (req, res) => {
    res.status(426).json({
      error: "upgrade required",
      message:
        "GET /pty/{id}/connect is a WebSocket upgrade endpoint; the express mock cannot upgrade natively — run tests/mock-server/ws-echo.mjs for WS channel contract tests (docs/tasks/M6.md appendix).",
      ticket: req.query.ticket,
    });
  });

  // ---- TASK-M9-05: config family (GET/PATCH /config + /global/config,
  //      POST /instance/dispose + /global/dispose) ----

  // PATCH merge semantics mirror the real server: nested plain objects
  // merge recursively, everything else (arrays included) replaces, and
  // keys absent from the patch stay untouched.
  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function mergeConfig(
    current: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      const existing = out[key];
      out[key] =
        isPlainObject(existing) && isPlainObject(value) ? mergeConfig(existing, value) : value;
    }
    return out;
  }

  // Per-directory project configs (like /session): each directory gets its
  // own mutable copy seeded from the fixture, so PATCH round-trips are
  // isolated per project context.
  const projectConfigs: Record<string, Record<string, unknown>> = {};

  function projectConfigOf(directory: string | undefined): Record<string, unknown> {
    const key = directory ?? "__default__";
    projectConfigs[key] ??= JSON.parse(JSON.stringify(fixtures["config"]));
    return projectConfigs[key];
  }

  app.get("/config", (req, res) => {
    res.json(projectConfigOf(queryString(req, "directory")));
  });

  app.patch("/config", (req, res) => {
    if (!isPlainObject(req.body)) {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid config patch" });
      return;
    }
    const key = queryString(req, "directory") ?? "__default__";
    projectConfigs[key] = mergeConfig(projectConfigs[key], req.body);
    res.json(projectConfigs[key]);
  });

  const globalConfig: Record<string, unknown> = JSON.parse(
    JSON.stringify(fixtures["global.config"]),
  );

  app.get("/global/config", (_req, res) => {
    res.json(globalConfig);
  });

  app.patch("/global/config", (req, res) => {
    if (!isPlainObject(req.body)) {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid config patch" });
      return;
    }
    Object.assign(globalConfig, mergeConfig(globalConfig, req.body));
    res.json(globalConfig);
  });

  // Provider catalog (TASK-S1-04): the real server loads providers declared
  // in the config into the catalog, so GET /provider merges the
  // `globalConfig.provider` entries (written by PATCH /global/config,
  // TASK-S1-02) into the fixture catalog — the walkthrough found the
  // client's catalog refresh after "Add provider" showed no new row because
  // the fixture-only catalog ignored the config. Config entries synthesize
  // a Provider with an empty models record (the client renders "Not
  // connected" until a key is set through /auth), preserving the fixture's
  // `default` and `connected` records.
  app.get("/provider", (_req, res) => {
    const catalog = (fixtures["provider"] ?? {}) as Record<string, unknown>;
    const all = Array.isArray(catalog.all) ? [...(catalog.all as Record<string, unknown>[])] : [];
    const knownIds = new Set(all.map((provider) => provider?.id));
    const configured = isPlainObject(globalConfig.provider) ? globalConfig.provider : {};
    for (const [id, config] of Object.entries(configured)) {
      if (knownIds.has(id)) continue;
      const provider = isPlainObject(config) ? config : {};
      all.push({
        id,
        name: typeof provider.name === "string" ? provider.name : id,
        source: "config",
        env: Array.isArray(provider.env) ? provider.env : [],
        options: isPlainObject(provider.options) ? provider.options : {},
        models: {},
      });
      knownIds.add(id);
    }
    res.json({
      ...catalog,
      all,
      default: isPlainObject(catalog.default) ? catalog.default : {},
      connected: Array.isArray(catalog.connected) ? catalog.connected : [],
    });
  });

  // Instance dispose (TASK-M9-05): the 1.18.11 contract answers a plain
  // boolean; the real server then shuts the instance down (the SSE stream
  // drops and the client degrades back to the server home).
  app.post("/instance/dispose", (_req, res) => {
    res.json(true);
  });

  // Global dispose (TASK-M9-05): same plain-boolean shape, releasing all
  // instances.
  app.post("/global/dispose", (_req, res) => {
    res.json(true);
  });

  // ---- TASK-M9-06: MCP family (GET/POST /mcp, connect/disconnect, OAuth) ----

  // Mutable per-server status map seeded from the fixture. The transitions
  // mirror the real server's lifecycle: connect starts the server process
  // (any failed/disabled/needs_auth server becomes connected), disconnect
  // stops it (connected becomes disabled); adding registers the server as
  // disabled, the user connects it from the card.
  type McpStatusValue =
    | { status: "connected" }
    | { status: "failed"; error: string }
    | { status: "disabled" }
    | { status: "needs_auth" }
    | { status: "needs_client_registration"; error: string };

  const mcpState: Record<string, McpStatusValue> = JSON.parse(
    JSON.stringify(fixtures["mcp.status"]),
  );

  // OAuth flow state per server: the state token handed to the IdP page and
  // whether the simulated browser round trip completed.
  const mcpOauth: Record<string, { state: string; completed: boolean }> = {};
  // Servers whose OAuth flow was started (the fixture's needs_auth server
  // plus any server an auth flow began on). DELETE /mcp/{name}/auth only
  // revokes credentials on these — a connected non-OAuth server must keep
  // its state.
  const mcpOauthCapable: Set<string> = new Set(
    Object.entries(mcpState)
      .filter(([, status]) => status.status === "needs_auth")
      .map(([name]) => name),
  );

  // The shared mock OAuth code (MOCK_OAUTH_CODE from the provider flow,
  // TASK-M5-07) doubles as the MCP code-flow code.

  function mcpServerOf(name: unknown): McpStatusValue | undefined {
    return typeof name === "string" ? mcpState[name] : undefined;
  }

  function serverNotFound(res: Response, name: unknown): void {
    res.status(404).json({
      _tag: "McpServerNotFoundError",
      name: String(name),
      message: `MCP server not found: ${String(name)}`,
    });
  }

  function unsupportedOAuth(res: Response): void {
    res.status(400).json({ error: "this MCP server does not support OAuth" });
  }

  app.get("/mcp", (_req, res) => {
    res.json(mcpState);
  });

  app.post("/mcp", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { name, config } = body;
    if (typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ _tag: "BadRequestError", message: "name is required" });
      return;
    }
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      res.status(400).json({ _tag: "BadRequestError", message: "config is required" });
      return;
    }
    const cfg = config as { type?: unknown; command?: unknown; url?: unknown };
    if (cfg.type === "local" && !Array.isArray(cfg.command)) {
      res
        .status(400)
        .json({ _tag: "BadRequestError", message: "local config needs a command array" });
      return;
    }
    if (cfg.type === "remote" && typeof cfg.url !== "string") {
      res.status(400).json({ _tag: "BadRequestError", message: "remote config needs a url" });
      return;
    }
    mcpState[name.trim()] = { status: "disabled" };
    res.json(mcpState);
  });

  app.post("/mcp/:name/connect", (req, res) => {
    if (mcpServerOf(req.params.name) === undefined) {
      serverNotFound(res, req.params.name);
      return;
    }
    mcpState[req.params.name] = { status: "connected" };
    res.json(true);
  });

  app.post("/mcp/:name/disconnect", (req, res) => {
    if (mcpServerOf(req.params.name) === undefined) {
      serverNotFound(res, req.params.name);
      return;
    }
    mcpState[req.params.name] = { status: "disabled" };
    res.json(true);
  });

  app.post("/mcp/:name/auth", (req, res) => {
    const status = mcpServerOf(req.params.name);
    if (status === undefined) {
      serverNotFound(res, req.params.name);
      return;
    }
    if (status.status !== "needs_auth") {
      unsupportedOAuth(res);
      return;
    }
    mcpOauthCapable.add(req.params.name);
    const oauthState = `mcp-oauth-${Math.random().toString(36).slice(2, 10)}`;
    mcpOauth[req.params.name] = { state: oauthState, completed: false };
    res.json({
      authorizationUrl: `http://${req.get("host")}/mcp/oauth/authorize?state=${oauthState}`,
      oauthState,
    });
  });

  app.delete("/mcp/:name/auth", (req, res) => {
    if (mcpServerOf(req.params.name) === undefined) {
      serverNotFound(res, req.params.name);
      return;
    }
    delete mcpOauth[req.params.name];
    // Removing the credentials revokes a completed authorization: an
    // OAuth-capable connected server needs authorization again (this also
    // keeps the L3 flow tests repeatable against a long-lived server).
    if (mcpOauthCapable.has(req.params.name) && mcpState[req.params.name].status === "connected") {
      mcpState[req.params.name] = { status: "needs_auth" };
    }
    res.json({ success: true });
  });

  // Simulated IdP page (mock extension, documented in docs/api-coverage.md
  // §5): the provider OAuth flow uses the same browser-round-trip page; for
  // MCP the flow's authorize URL points here and a visit marks the flow
  // completed, which the authenticate poll observes.
  app.get("/mcp/oauth/authorize", (req, res) => {
    const state = queryString(req, "state");
    const server = Object.entries(mcpOauth).find(([, oauth]) => oauth.state === state)?.[0];
    if (server === undefined) {
      res.status(400).json({ _tag: "BadRequestError", message: "unknown oauth state" });
      return;
    }
    mcpOauth[server].completed = true;
    res
      .status(200)
      .type("html")
      .send("<html><body><p>Authorization complete — you can close this window.</p></body></html>");
  });

  // Non-blocking in the mock: answers the current flow status immediately.
  // `?poll=1` is the explicit poll variant the client uses (mirror of the
  // provider OAuth `poll: true` body extension of TASK-M5-07); a real
  // server ignores the unknown query parameter and blocks until the
  // callback completes.
  app.post("/mcp/:name/auth/authenticate", (req, res) => {
    const status = mcpServerOf(req.params.name);
    if (status === undefined) {
      serverNotFound(res, req.params.name);
      return;
    }
    if (status.status !== "needs_auth") {
      unsupportedOAuth(res);
      return;
    }
    // A completed flow authenticates the server for good (the callback and
    // the poll both observe the completion, mirroring the real server).
    if (mcpOauth[req.params.name]?.completed === true) {
      mcpState[req.params.name] = { status: "connected" };
      delete mcpOauth[req.params.name];
      res.json({ status: "connected" });
      return;
    }
    res.json(status);
  });

  app.post("/mcp/:name/auth/callback", (req, res) => {
    const status = mcpServerOf(req.params.name);
    if (status === undefined) {
      serverNotFound(res, req.params.name);
      return;
    }
    const code = (req.body as { code?: unknown } | undefined)?.code;
    if (code !== MOCK_OAUTH_CODE) {
      res.status(400).json({ _tag: "BadRequestError", message: "invalid authorization code" });
      return;
    }
    mcpState[req.params.name] = { status: "connected" };
    delete mcpOauth[req.params.name];
    res.json({ status: "connected" });
  });

  // ---- TASK-M9-07: log forwarding (POST /log) ----
  // Validates the contract body ({ service, level, message, extra? }; the
  // level enum is debug|info|error|warn) and answers true. Entries are
  // discarded — the mock has no log sink.
  app.post("/log", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { service, level, message } = body;
    const VALID_LEVELS = ["debug", "info", "error", "warn"];
    if (typeof service !== "string" || service === "") {
      res.status(400).json({ _tag: "InvalidRequestError", message: "service is required" });
      return;
    }
    if (typeof level !== "string" || !VALID_LEVELS.includes(level)) {
      res.status(400).json({ _tag: "InvalidRequestError", message: "invalid level" });
      return;
    }
    if (typeof message !== "string" || message === "") {
      res.status(400).json({ _tag: "InvalidRequestError", message: "message is required" });
      return;
    }
    res.json(true);
  });

  // ---- TASK-M9-07: saved permission rules (V2 directory) ----
  // GET lists the fixture rules; DELETE removes one and answers 204
  // (contract has no error variant for a missing id — any id that is not
  // in the list still answers 204).
  const savedRules: Record<
    string,
    { id: string; projectID: string; action: string; resource: string }
  > = Object.fromEntries(
    ((fixtures["permission.saved"] as { data?: unknown })?.data ?? []).map(
      (rule: { id?: unknown; projectID?: unknown; action?: unknown; resource?: unknown }) => [
        String(rule.id),
        {
          id: String(rule.id),
          projectID: String(rule.projectID),
          action: String(rule.action),
          resource: String(rule.resource),
        },
      ],
    ),
  );

  app.get("/api/permission/saved", (_req, res) => {
    res.json({ data: Object.values(savedRules) });
  });

  app.delete("/api/permission/saved/:id", (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string" || id === "") {
      res.status(400).json({ _tag: "InvalidRequestError", message: "id is required" });
      return;
    }
    delete savedRules[id];
    res.status(204).end();
  });

  // ---- TASK-M9-07: global upgrade (POST /global/upgrade) ----
  // The diagnostics UI is display-only (no button); the mock documents the
  // contract shape for future callers.
  app.post("/global/upgrade", (_req, res) => {
    res.json({ success: true, version: "1.19.0" });
  });

  // ---- TASK-UI-01: RFC 9728 server OAuth (managed OAuth reference) ----
  // The mock exposes an oauth-authorization-server discovery document at
  // /.well-known/oauth-authorization-server, plus a token endpoint that
  // completes the authorization-code grant (with the fixed mock code and
  // any PKCE verifier) and the refresh grant. The authorization endpoint
  // itself is simulated: the client opens the returned URL in a browser
  // that does not exist in tests, so the flow is exercised through
  // `oauth_discover` → `oauth_authorize` (URL shape) → paste the mock
  // code → `oauth_exchange` → `oauth_refresh` → `oauth_clear`.
  const MOCK_SERVER_OAUTH_CODE = "mock-server-oauth-code";
  const MOCK_SERVER_REFRESH = "mock-server-refresh-token";

  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    res.json({
      issuer: `http://${reqHost(req)}`,
      authorization_endpoint: `http://${reqHost(req)}/server-oauth/authorize`,
      token_endpoint: `http://${reqHost(req)}/server-oauth/token`,
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "profile"],
    });
  });

  // Simulated authorization page: reports the parameters the client would
  // have sent (for the self-test assertions) and issues the mock code.
  app.get("/server-oauth/authorize", (req, res) => {
    res.json({
      ok: true,
      code: MOCK_SERVER_OAUTH_CODE,
      state: req.query.state ?? null,
      client_id: req.query.client_id ?? null,
      code_challenge: req.query.code_challenge ?? null,
    });
  });

  // Token endpoint: exchanges the mock code (authorization_code grant)
  // or refreshes (refresh_token grant). Both issue an access token, a
  // refresh token and a 3600s expiry.
  app.post("/server-oauth/token", (req, res) => {
    const grant = req.body?.grant_type;
    const code = req.body?.code;
    const refresh = req.body?.refresh_token;
    if (grant === "authorization_code") {
      if (code !== MOCK_SERVER_OAUTH_CODE) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
    } else if (grant === "refresh_token") {
      if (refresh !== MOCK_SERVER_REFRESH) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
    } else {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }
    res.json({
      access_token: "mock-server-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: MOCK_SERVER_REFRESH,
      scope: "openid profile",
    });
  });
}

/** Host header of the current request (used to build absolute mock URLs). */
function reqHost(req: Request): string {
  return req.get("host") ?? "localhost:14096";
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
