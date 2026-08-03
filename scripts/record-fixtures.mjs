// Fixture recording script (docs/testing.md §2.1 "录制轨").
//
// Captures real responses from a running `opencode serve` instance and saves
// them as fixtures for the mock server and contract tests:
//
//   node scripts/record-fixtures.mjs <baseURL> [--out tests/fixtures]
//   pnpm fixtures:record http://localhost:14096
//
// For every target endpoint the response JSON is written to <out>/<file>,
// redacted (user home path, username, hostname replaced by generic
// placeholders), and mapped to its key(s) in <out>/index.json. Endpoints that
// fail are skipped with a warning so a partial capture is still committed.
// Requires Node 20+ (global fetch). Does not start or stop the server.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_OUT = "tests/fixtures";

// Home path / username / hostname redaction. The real `opencode serve` echoes
// absolute paths (session.directory, FileNode.absolute, pty.cwd, ...), which
// must not leak into the repo.
const HOME_DIR = os.homedir();
const USER_NAME = os.userInfo().username;
const HOST_NAME = os.hostname();

// Endpoint targets, in dependency order: later targets may consume the
// recorded responses of earlier ones via `dependsOn` (e.g. the first session
// id) to build coherent URLs.
const TARGETS = [
  { keys: ["health"], file: "health.json", url: (base) => `${base}/global/health` },
  { keys: ["project.list"], file: "project.list.json", url: (base) => `${base}/project` },
  { keys: ["project.current"], file: "project.current.json", url: (base) => `${base}/project/current` },
  { keys: ["session.list"], file: "session.list.json", url: (base) => `${base}/session` },
  {
    keys: ["session.detail"],
    file: "session.detail.json",
    dependsOn: "sessionID",
    url: (base, ctx) => `${base}/session/${ctx.sessionID}`,
  },
  {
    keys: ["session.messages"],
    file: "session.messages.json",
    dependsOn: "sessionID",
    url: (base, ctx) => `${base}/session/${ctx.sessionID}/message`,
  },
  {
    keys: ["session.message"],
    file: "session.message.json",
    dependsOn: "messageID",
    url: (base, ctx) => `${base}/session/${ctx.sessionID}/message/${ctx.messageID}`,
  },
  {
    keys: ["session.todo", "todo.list"],
    file: "todo.list.json",
    dependsOn: "sessionID",
    url: (base, ctx) => `${base}/session/${ctx.sessionID}/todo`,
  },
  { keys: ["permission.asked"], file: "permission.asked.json", url: (base) => `${base}/permission` },
  { keys: ["question.asked"], file: "question.asked.json", url: (base) => `${base}/question` },
  {
    keys: ["file.tree"],
    file: "file.tree.json",
    dependsOn: "worktree",
    url: (base, ctx) => `${base}/file?directory=${encodeURIComponent(ctx.worktree)}&path=.`,
  },
  {
    keys: ["diff.session"],
    file: "diff.session.json",
    dependsOn: "sessionID",
    url: (base, ctx) => `${base}/session/${ctx.sessionID}/diff`,
  },
  { keys: ["pty.list"], file: "pty.list.json", url: (base) => `${base}/pty` },
];

function printUsage() {
  console.log(
    [
      "Usage: node scripts/record-fixtures.mjs <baseURL> [--out tests/fixtures]",
      "",
      "Captures real responses from a running `opencode serve` instance and",
      "writes redacted fixtures + index.json into the fixtures root.",
      "",
      "Options:",
      "  --out <dir>  fixture root to write into (default: tests/fixtures)",
      "  --help, -h   show this help",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = { out: DEFAULT_OUT };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") options.out = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else positional.push(arg);
  }
  return { baseURL: positional[0], ...options };
}

function redactString(value) {
  let out = value;
  if (HOME_DIR) out = out.split(HOME_DIR).join("/home/user");
  if (USER_NAME) out = out.split(USER_NAME).join("user");
  if (HOST_NAME) out = out.split(HOST_NAME).join("localhost");
  return out;
}

function redact(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  }
  return value;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Derives the shared context (first session id / message id / project
// worktree) from the responses recorded so far, so later targets can build
// coherent URLs.
function buildContext(recorded) {
  const ctx = {};
  const sessions = recorded["session.list"];
  if (Array.isArray(sessions) && sessions.length > 0) ctx.sessionID = sessions[0].id;
  const messages = recorded["session.messages"];
  if (Array.isArray(messages) && messages.length > 0) ctx.messageID = messages[0].info?.id;
  const projects = recorded["project.list"];
  if (Array.isArray(projects) && projects.length > 0) ctx.worktree = projects[0].worktree;
  return ctx;
}

const { baseURL, out } = parseArgs(process.argv.slice(2));
if (!baseURL) {
  console.error("error: missing <baseURL> (see --help)");
  process.exit(1);
}

const outDir = resolve(out);
await mkdir(outDir, { recursive: true });

const indexFile = join(outDir, "index.json");
const index = existsSync(indexFile)
  ? JSON.parse(await readFile(indexFile, "utf8"))
  : {};

const recorded = {};
const skipped = [];

for (const target of TARGETS) {
  try {
    const ctx = buildContext(recorded);
    if (target.dependsOn !== undefined && ctx[target.dependsOn] === undefined) {
      throw new Error(`missing context "${target.dependsOn}" (its source endpoint was skipped)`);
    }
    const data = redact(await fetchJson(target.url(baseURL, ctx)));
    await writeFile(join(outDir, target.file), `${JSON.stringify(data, null, 2)}\n`);
    for (const key of target.keys) index[key] = target.file;
    recorded[target.keys[0]] = data;
    console.log(`[fixtures:record] ok   ${target.keys.join(", ")} -> ${target.file}`);
  } catch (err) {
    skipped.push(`${target.keys[0]} (${err.message})`);
    console.warn(`[fixtures:record] skip ${target.keys[0]}: ${err.message}`);
  }
}

await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`);

console.log(`\n[fixtures:record] recorded ${Object.keys(recorded).length}/${TARGETS.length} targets into ${outDir}`);
if (skipped.length > 0) {
  console.warn(`[fixtures:record] skipped: ${skipped.join("; ")}`);
}
if (Object.keys(recorded).length === 0) {
  console.error("[fixtures:record] nothing recorded; check the baseURL and that `opencode serve` is running");
  process.exitCode = 1;
}
