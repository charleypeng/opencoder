// Self-test for the mock OpenCode server.
//
// Starts the server on random ports and asserts:
//   - fixture responses (health / project / session family) match the
//     OpenAPI shapes
//   - unimplemented endpoints return 501
//   - fault injection (?__fail, ?__slow) works
//   - Basic Auth is enforced when configured
//   - dev CORS is off by default and works when enabled
//
// Run with: pnpm mock:test
// Exits non-zero on the first failed assertion group.

import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok ${name}`);
    })
    .catch((err) => {
      failed += 1;
      console.error(`  FAIL ${name}: ${err.message}`);
    });
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

function randomPort() {
  return 20000 + Math.floor(Math.random() * 40000);
}

function startServer(args, options = {}) {
  const child = spawn("pnpm", ["exec", "tsx", "tests/mock-server/index.ts", ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: options.env ? { ...process.env, ...options.env } : undefined,
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  return { child, getOutput: () => output };
}

async function waitForReady(baseUrl, server, options = {}) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`server exited early (code ${server.child.exitCode})\n${server.getOutput()}`);
    }
    try {
      const res = await fetch(`${baseUrl}/global/health`, options);
      if (res.status > 0) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not become ready\n${server.getOutput()}`);
}

async function request(baseUrl, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body.
  }
  return { status: res.status, headers: res.headers, body };
}

async function shutdown(servers) {
  await Promise.all(
    servers.map((server) => {
      return new Promise((resolve) => {
        const child = server.child;
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2000);
      });
    }),
  );
}

// Opens an SSE stream and collects parsed events until `until` returns
// truthy (the client then closes the connection) or the server closes the
// stream, whichever comes first.
function collectSSE(baseUrl, path, until, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const events = [];
    let buffer = "";
    let req;
    const timer = setTimeout(() => {
      req.destroy();
      reject(
        new Error(
          `timed out after ${timeoutMs}ms; got: ${events.map((e) => e.type ?? e.payload?.type).join(", ")}`,
        ),
      );
    }, timeoutMs);
    const settle = (fn, value) => {
      clearTimeout(timer);
      fn(value);
    };
    req = http.get(`${baseUrl}${path}`, (res) => {
      if (res.statusCode !== 200) {
        settle(reject, new Error(`SSE status ${res.statusCode}`));
        req.destroy();
        return;
      }
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              events.push(JSON.parse(line.slice(5).trim()));
            } catch {
              // Malformed frame; skip.
            }
          }
          if (until(events)) {
            settle(resolve, events);
            req.destroy();
            return;
          }
        }
      });
      res.on("end", () => settle(resolve, events));
      res.on("error", (err) => settle(reject, err));
    });
    req.on("error", (err) => settle(reject, err));
  });
}

const SESSION_ID = "ses_abc123";

function typesOf(events) {
  return events.map((e) => e.type ?? e.payload?.type);
}

// Collects an SSE scenario until `session.idle` arrives and asserts the
// given type sequence appears in order, with server.connected first and
// session.idle last. Returns the collected events.
async function expectScenarioSequence(baseUrl, scenario, middleTypes) {
  const events = await collectSSE(baseUrl, `/event?scenario=${scenario}`, (evts) =>
    evts.some((e) => e.type === "session.idle"),
  );
  const types = typesOf(events);
  const order = ["server.connected", "session.created", ...middleTypes];
  let prev = -1;
  for (const type of order) {
    const idx = types.indexOf(type);
    expect(idx > prev, `expected "${type}" in sequence; got ${types.join(", ")}`);
    prev = idx;
  }
  expect(
    types[types.length - 1] === "session.idle",
    `session.idle must be last; got ${types.join(", ")}`,
  );
  return events;
}

const servers = [];
let baseUrl;

try {
  // ---- Server without auth / cors ----
  {
    const port = randomPort();
    baseUrl = `http://localhost:${port}`;
    servers.push(startServer(["--port", String(port)]));
    await waitForReady(baseUrl, servers[0]);

    await test("health returns fixture shape", async () => {
      const { status, body } = await request(baseUrl, "/global/health");
      expect(status === 200, `status ${status}`);
      expect(body.healthy === true, "healthy must be true");
      expect(body.version === "1.18.11-mock", `version ${JSON.stringify(body.version)}`);
    });

    await test("project list returns fixture array", async () => {
      const { status, body } = await request(baseUrl, "/project");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body), "body must be an array");
      expect(body.length >= 2, `dual-project fixture must have >= 2 projects, got ${body.length}`);
      expect(typeof body[0]?.id === "string", "first item must have string id");
      expect(typeof body[0]?.worktree === "string", "first item must have string worktree");
    });

    await test("directory-aware contexts isolate project data", async () => {
      const labs = encodeURIComponent("/mock/projects/opencode-labs");
      const demo = encodeURIComponent("/mock/projects/opencode-demo");

      const current = await request(baseUrl, `/project/current?directory=${labs}`);
      expect(
        current.body?.id === "project-mock-2",
        `labs current id ${JSON.stringify(current.body?.id)}`,
      );
      const fallback = await request(baseUrl, "/project/current");
      expect(
        fallback.body?.id === "project-mock-1",
        `default current id ${JSON.stringify(fallback.body?.id)}`,
      );

      const sessions = await request(baseUrl, `/session?directory=${labs}`);
      expect(
        sessions.body?.[0]?.projectID === "project-mock-2",
        "labs sessions must belong to project-mock-2",
      );
      expect(
        sessions.body?.[0]?.directory === "/mock/projects/opencode-labs",
        "labs sessions must carry the labs directory",
      );
      const demoSessions = await request(baseUrl, `/session?directory=${demo}`);
      expect(
        demoSessions.body?.[0]?.id === "sess_01",
        "demo sessions must stay on the default fixture",
      );
    });

    await test("session list returns session array", async () => {
      const { status, body } = await request(baseUrl, "/session");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body), "body must be an array");
      const s = body[0];
      expect(typeof s?.id === "string", "first item must have string id");
      expect(typeof s?.title === "string", "first item must have string title");
      expect(typeof s?.version === "string", "first item must have string version");
      expect(typeof s?.time?.created === "number", "first item must have numeric time.created");
    });

    await test("session detail returns session object", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01");
      expect(status === 200, `status ${status}`);
      expect(body.id === "sess_01", `id ${JSON.stringify(body.id)}`);
      expect(typeof body.time?.updated === "number", "time.updated must be numeric");
    });

    await test("session messages returns message/part entries", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/message");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body), "body must be an array");
      const first = body[0];
      expect(typeof first?.info?.id === "string", "entry must have info.id");
      expect(Array.isArray(first?.parts), "entry must have parts array");
      expect(typeof first?.parts?.[0]?.type === "string", "part must have a type");
    });

    await test("single message returns info + parts", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/message/msg_02");
      expect(status === 200, `status ${status}`);
      expect(body.info?.id === "msg_02", `info.id ${JSON.stringify(body.info?.id)}`);
      expect(Array.isArray(body.parts), "parts must be an array");
    });

    await test("message delete returns true", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/message/msg_02", {
        method: "DELETE",
      });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("part patch echoes the part with path ids", async () => {
      const { status, body } = await request(
        baseUrl,
        "/session/sess_01/message/msg_02/part/part_02",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "part_02", type: "text", text: "edited" }),
        },
      );
      expect(status === 200, `status ${status}`);
      expect(body.text === "edited", `text ${JSON.stringify(body.text)}`);
      expect(body.id === "part_02", `id ${JSON.stringify(body.id)}`);
      expect(body.sessionID === "sess_01", `sessionID ${JSON.stringify(body.sessionID)}`);
      expect(body.messageID === "msg_02", `messageID ${JSON.stringify(body.messageID)}`);
    });

    await test("part delete returns true", async () => {
      const { status, body } = await request(
        baseUrl,
        "/session/sess_01/message/msg_02/part/part_02",
        { method: "DELETE" },
      );
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("path returns the instance path info", async () => {
      const { status, body } = await request(baseUrl, "/path");
      expect(status === 200, `status ${status}`);
      expect(typeof body?.directory === "string", "directory must be a string");
      expect(typeof body?.worktree === "string", "worktree must be a string");
      expect(typeof body?.home === "string", "home must be a string");
      expect(typeof body?.state === "string", "state must be a string");
      expect(typeof body?.config === "string", "config must be a string");
    });

    await test("session status returns a status map keyed by session id", async () => {
      const { status, body } = await request(baseUrl, "/session/status");
      expect(status === 200, `status ${status}`);
      expect(
        typeof body === "object" && body !== null && !Array.isArray(body),
        "body must be an object map",
      );
      const statuses = Object.values(body);
      expect(statuses.length > 0, "map must not be empty");
      for (const s of statuses) {
        expect(
          ["idle", "busy", "retry"].includes(s?.type),
          `status type ${JSON.stringify(s?.type)}`,
        );
      }
    });

    await test("session create honors title and parentID", async () => {
      const { status, body } = await request(baseUrl, "/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New session", parentID: "sess_01" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body.title === "New session", `title ${JSON.stringify(body.title)}`);
      expect(body.parentID === "sess_01", `parentID ${JSON.stringify(body.parentID)}`);
      expect(typeof body.id === "string", "created session must have an id");
      expect(typeof body.version === "string", "created session must carry a version");
    });

    await test("session update patches the title", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body.id === "sess_01", `id ${JSON.stringify(body.id)}`);
      expect(body.title === "Renamed", `title ${JSON.stringify(body.title)}`);
    });

    await test("session delete returns true", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_02", { method: "DELETE" });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("prompt_async returns 204", async () => {
      const { status } = await request(baseUrl, "/session/sess_01/prompt_async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
      });
      expect(status === 204, `status ${status}`);
    });

    // TASK-M3-08: the composer sends attachments as FilePartInput parts.
    await test("prompt_async accepts file parts alongside text parts", async () => {
      const { status } = await request(baseUrl, "/session/sess_01/prompt_async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [
            { type: "text", text: "check this" },
            {
              type: "file",
              mime: "image/png",
              filename: "clip.png",
              url: "data:image/png;base64,aGVsbG8=",
            },
          ],
        }),
      });
      expect(status === 204, `status ${status}`);
    });

    // TASK-M3-08: the @-reference menu searches /find/file.
    await test("find/file filters the file list by query", async () => {
      const { status, body } = await request(baseUrl, "/find/file?query=PromptBox");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body), "body must be an array");
      expect(body.length >= 1, `expected >= 1 match; got ${body.length}`);
      expect(
        typeof body[0] === "string" && body[0].includes("PromptBox"),
        `first match ${JSON.stringify(body[0])}`,
      );
    });

    await test("find/file with an empty query returns an empty array", async () => {
      const { status, body } = await request(baseUrl, "/find/file?query=");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 0, `expected []; got ${JSON.stringify(body)}`);
    });

    await test("find/file with no matches returns an empty array", async () => {
      const { status, body } = await request(baseUrl, "/find/file?query=zzz_no_match");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 0, `expected []; got ${JSON.stringify(body)}`);
    });

    await test("find returns text search matches", async () => {
      const { status, body } = await request(baseUrl, "/find?pattern=prompt");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length > 0, "body must be a non-empty array");
      expect(typeof body[0]?.path?.text === "string", "match must carry path.text");
      expect(typeof body[0]?.line_number === "number", "match must carry line_number");
      expect(Array.isArray(body[0]?.submatches), "match must carry submatches");
      expect(
        body[0]?.lines?.text?.slice(
          body[0]?.submatches?.[0]?.start,
          body[0]?.submatches?.[0]?.end,
        ) === body[0]?.submatches?.[0]?.match?.text,
        "submatch offsets must align with the line text",
      );
    });

    await test("find filters matches by pattern", async () => {
      const { status, body } = await request(baseUrl, "/find?pattern=createSignal");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length >= 2, `expected >= 2; got ${JSON.stringify(body)}`);
      for (const match of body) {
        expect(
          typeof match?.lines?.text === "string" && match.lines.text.includes("createSignal"),
          `line must contain the pattern; got ${JSON.stringify(match?.lines)}`,
        );
      }
    });

    await test("find with no matches returns an empty array", async () => {
      const { status, body } = await request(baseUrl, "/find?pattern=zzz_no_match");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 0, `expected []; got ${JSON.stringify(body)}`);
    });

    await test("find with an empty pattern returns an empty array", async () => {
      const { status, body } = await request(baseUrl, "/find?pattern=");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 0, `expected []; got ${JSON.stringify(body)}`);
    });

    await test("find regex mode matches regular expressions", async () => {
      const { status, body } = await request(baseUrl, "/find?pattern=create%5Cw%2B&regex=true");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length >= 2, `expected >= 2; got ${JSON.stringify(body)}`);
    });

    await test("find without the regex flag treats the pattern as a literal", async () => {
      const { status, body } = await request(baseUrl, "/find?pattern=create%5Cw%2B");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 0, `expected []; got ${JSON.stringify(body)}`);
    });

    await test("find with an invalid regex returns an empty array", async () => {
      const { status, body } = await request(baseUrl, "/find?pattern=%28&regex=true");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 0, `expected []; got ${JSON.stringify(body)}`);
    });

    await test("find/symbol returns workspace symbols", async () => {
      const { status, body } = await request(baseUrl, "/find/symbol?query=Prompt");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length > 0, "body must be a non-empty array");
      expect(typeof body[0]?.name === "string", "symbol must carry a name");
      expect(typeof body[0]?.kind === "number", "symbol must carry a numeric kind");
      expect(typeof body[0]?.location?.uri === "string", "symbol must carry a location uri");
      expect(
        typeof body[0]?.location?.range?.start?.line === "number" &&
          typeof body[0]?.location?.range?.start?.character === "number",
        "symbol location must carry a 0-based start position",
      );
    });

    await test("find/symbol filters symbols by query name substring", async () => {
      const { body } = await request(baseUrl, "/find/symbol?query=build");
      expect(Array.isArray(body) && body.length >= 1, `expected >= 1; got ${body?.length}`);
      for (const symbol of body) {
        expect(
          typeof symbol?.name === "string" && symbol.name.toLowerCase().includes("build"),
          `name must contain the query; got ${JSON.stringify(symbol?.name)}`,
        );
      }
      expect(
        body[0]?.location?.range?.start?.line === 91,
        `start line ${JSON.stringify(body[0]?.location?.range?.start)}`,
      );
    });

    await test("find/symbol with an empty query returns an empty array", async () => {
      const { status, body } = await request(baseUrl, "/find/symbol?query=");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 0, `expected []; got ${JSON.stringify(body)}`);
    });

    await test("find/symbol fixture spans multiple kinds", async () => {
      // "e" matches six of the seven fixture names, exposing the kind
      // spread (function/method/class/interface/variable/constant).
      const { body } = await request(baseUrl, "/find/symbol?query=e");
      expect(Array.isArray(body) && body.length >= 5, `expected >= 5 symbols; got ${body?.length}`);
      const kinds = new Set(body.map((symbol) => symbol?.kind));
      expect(kinds.size >= 4, `expected >= 4 kinds in fixture; got ${[...kinds].join(", ")}`);
    });

    await test("find/symbol with no matches returns an empty array", async () => {
      const { status, body } = await request(baseUrl, "/find/symbol?query=zzz_no_match");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 0, `expected []; got ${JSON.stringify(body)}`);
    });

    // TASK-M4-01: /file family.
    await test("file list returns FileNode entries", async () => {
      const { status, body } = await request(baseUrl, "/file");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length > 0, "body must be a non-empty array");
      const node = body[0];
      expect(typeof node?.name === "string", "FileNode must carry name");
      expect(typeof node?.path === "string", "FileNode must carry path");
      expect(typeof node?.absolute === "string", "FileNode must carry absolute");
      expect(
        ["file", "directory"].includes(node?.type),
        `FileNode type ${JSON.stringify(node?.type)}`,
      );
      expect(typeof node?.ignored === "boolean", "FileNode must carry ignored");
      expect(
        body.some((n) => n.ignored === true),
        "fixture must include an ignored node",
      );
    });

    await test("file content returns FileContent", async () => {
      const { status, body } = await request(baseUrl, "/file/content?path=README.md");
      expect(status === 200, `status ${status}`);
      expect(["text", "binary"].includes(body?.type), `content type ${JSON.stringify(body?.type)}`);
      expect(typeof body?.content === "string", "content must be a string");
    });

    await test("file status returns tracked file statuses", async () => {
      const { status, body } = await request(baseUrl, "/file/status");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length > 0, "body must be a non-empty array");
      const entry = body[0];
      expect(typeof entry?.path === "string", "entry must carry path");
      expect(
        ["added", "deleted", "modified"].includes(entry?.status),
        `status ${JSON.stringify(entry?.status)}`,
      );
      expect(
        typeof entry?.added === "number" && typeof entry?.removed === "number",
        "entry must carry added/removed counts",
      );
    });

    // TASK-M4-01: /vcs family.
    await test("vcs returns branch info", async () => {
      const { status, body } = await request(baseUrl, "/vcs");
      expect(status === 200, `status ${status}`);
      expect(typeof body?.branch === "string", `branch ${JSON.stringify(body?.branch)}`);
      expect(
        typeof body?.default_branch === "string",
        `default_branch ${JSON.stringify(body?.default_branch)}`,
      );
    });

    await test("vcs status returns the change list", async () => {
      const { status, body } = await request(baseUrl, "/vcs/status");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length > 0, "body must be a non-empty array");
      const entry = body[0];
      expect(typeof entry?.file === "string", "entry must carry file");
      expect(
        ["added", "deleted", "modified"].includes(entry?.status),
        `status ${JSON.stringify(entry?.status)}`,
      );
      expect(
        typeof entry?.additions === "number" && typeof entry?.deletions === "number",
        "entry must carry additions/deletions counts",
      );
    });

    await test("vcs diff returns per-file patches", async () => {
      const { status, body } = await request(baseUrl, "/vcs/diff?mode=git");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length > 0, "body must be a non-empty array");
      const entry = body[0];
      expect(typeof entry?.file === "string", "entry must carry file");
      expect(typeof entry?.patch === "string", "entry must carry a unified patch");
      expect(
        typeof entry?.additions === "number" && typeof entry?.deletions === "number",
        "entry must carry additions/deletions counts",
      );
    });

    await test("vcs diff raw returns unified diff text", async () => {
      const res = await fetch(`${baseUrl}/vcs/diff/raw`);
      const text = await res.text();
      expect(res.status === 200, `status ${res.status}`);
      expect(
        (res.headers.get("content-type") ?? "").startsWith("text/x-diff"),
        "content type must be text/x-diff",
      );
      expect(text.includes("diff --git"), "raw diff must be unified diff text");
    });

    await test("vcs apply returns the applied result", async () => {
      const { status, body } = await request(baseUrl, "/vcs/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: "--- a/x\n+++ b/x\n" }),
      });
      expect(status === 200, `status ${status}`);
      expect(typeof body?.applied === "boolean", `applied ${JSON.stringify(body?.applied)}`);
      expect(body?.applied === true, "mock apply must report success");
    });

    await test("session diff returns SnapshotFileDiff entries", async () => {
      const { status, body } = await request(baseUrl, `/session/${SESSION_ID}/diff`);
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length > 0, "body must be a non-empty array");
      const entry = body[0];
      expect(typeof entry?.file === "string", "entry must carry file");
      expect(typeof entry?.patch === "string", "entry must carry patch");
      expect(
        typeof entry?.additions === "number" && typeof entry?.deletions === "number",
        "entry must carry additions/deletions counts",
      );
    });

    await test("session diff filters by messageID", async () => {
      const full = await request(baseUrl, `/session/${SESSION_ID}/diff`);
      const filtered = await request(baseUrl, `/session/${SESSION_ID}/diff?messageID=msg_02`);
      expect(
        Array.isArray(filtered.body) && filtered.body.length < full.body.length,
        `filtered must be a strict subset; got ${filtered.body?.length} of ${full.body?.length}`,
      );
      const none = await request(baseUrl, `/session/${SESSION_ID}/diff?messageID=msg_nope`);
      expect(
        Array.isArray(none.body) && none.body.length === 0,
        `unknown messageID must yield []; got ${JSON.stringify(none.body)}`,
      );
    });

    await test("abort returns true", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/abort", {
        method: "POST",
      });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    // TASK-M6-03: session fork family.
    await test("session fork creates a child session carrying the parent id", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(status === 200, `status ${status}`);
      expect(typeof body?.id === "string", "child must carry an id");
      expect(body?.parentID === "sess_01", `parentID ${JSON.stringify(body?.parentID)}`);
      expect(typeof body?.time?.updated === "number", "child must carry numeric time.updated");
      expect(typeof body?.version === "string", "child must carry a version");
    });

    await test("session fork honors the messageID body", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageID: "msg_02" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body?.parentID === "sess_01", `parentID ${JSON.stringify(body?.parentID)}`);
    });

    await test("session fork rejects an unknown messageID", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageID: "msg_nope" }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    // TASK-M6-07: session children family.
    await test("session children lists the direct children with the parent id", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/children");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body), "children must be an array");
      expect(
        body.length === 1 && body[0]?.id === "sess_02" && body[0]?.parentID === "sess_01",
        `children ${JSON.stringify(body)}`,
      );
    });

    await test("session children descend the multi-level tree", async () => {
      const level2 = await request(baseUrl, "/session/sess_02/children");
      const level3 = await request(baseUrl, "/session/sess_03/children");
      const level4 = await request(baseUrl, "/session/sess_04/children");
      expect(
        level2.body?.[0]?.id === "sess_03" && level2.body?.[0]?.parentID === "sess_02",
        `level2 ${JSON.stringify(level2.body)}`,
      );
      expect(
        level3.body?.[0]?.id === "sess_04" && level3.body?.[0]?.parentID === "sess_03",
        `level3 ${JSON.stringify(level3.body)}`,
      );
      expect(
        Array.isArray(level4.body) && level4.body.length === 0,
        `leaf must yield []; got ${JSON.stringify(level4.body)}`,
      );
    });

    await test("session children 404 for an unknown session", async () => {
      const { status } = await request(baseUrl, "/session/sess_nope/children");
      expect(status === 404, `status ${status}`);
    });

    // TASK-M6-07: sync message family.
    await test("sync message reports the created assistant message", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
      });
      expect(status === 200, `status ${status}`);
      expect(
        body?.info?.role === "assistant" && body?.info?.sessionID === "sess_01",
        `info ${JSON.stringify(body?.info)}`,
      );
      expect(Array.isArray(body?.parts), "parts must be an array");
    });

    await test("sync message rejects a malformed payload", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    // TASK-M6-04: session revert family.
    await test("session revert sets the revert point on the session", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageID: "msg_02" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body?.id === "sess_01", `id ${JSON.stringify(body?.id)}`);
      expect(body?.revert?.messageID === "msg_02", `revert ${JSON.stringify(body?.revert)}`);
    });

    await test("session revert requires a messageID", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("session revert rejects an unknown messageID", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageID: "msg_nope" }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("session unrevert clears the revert marker", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/unrevert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      expect(status === 200, `status ${status}`);
      expect(body?.id === "sess_01", `id ${JSON.stringify(body?.id)}`);
      expect(body?.revert === undefined, `revert ${JSON.stringify(body?.revert)}`);
    });

    // TASK-M6-05: session share family.
    await test("session share reports the updated session with a share URL", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      expect(status === 200, `status ${status}`);
      expect(body?.id === "sess_01", `id ${JSON.stringify(body?.id)}`);
      expect(typeof body?.share?.url === "string", `share ${JSON.stringify(body?.share)}`);
      expect(typeof body?.time?.updated === "number", "share must carry numeric time.updated");
    });

    await test("session unshare clears the share marker", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      expect(status === 200, `status ${status}`);
      expect(body?.id === "sess_01", `id ${JSON.stringify(body?.id)}`);
      expect(body?.share === undefined, `share ${JSON.stringify(body?.share)}`);
    });

    // TASK-M6-06: session summarize/init family.
    await test("session summarize reports success with a known provider/model", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: "openai", modelID: "gpt-5" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("session summarize accepts the optional auto flag", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: "openai", modelID: "gpt-5", auto: true }),
      });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("session summarize rejects an unknown provider/model", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: "openai", modelID: "gpt-nope" }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("session summarize requires providerID and modelID", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: "openai" }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("session init reports success with the full body", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: "openai", modelID: "gpt-5", messageID: "msg_02" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("session init rejects an unknown messageID", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: "openai", modelID: "gpt-5", messageID: "msg_nope" }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("session init requires the full provider/model/messageID body", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: "openai", modelID: "gpt-5" }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("session messages honors the limit pagination param", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/message?limit=1");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 1, `expected 1 entry; got ${body?.length}`);
    });

    // TASK-M3-05: `limit` serves the most recent page (chronological order),
    // `before` pages strictly older messages (no overlap), unknown ids yield
    // an empty array and a full page chain walks the whole fixture once.
    await test("session messages serves the most recent page by default", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/message?limit=1");
      expect(status === 200, `status ${status}`);
      expect(body.length === 1, `expected 1 entry; got ${body?.length}`);
      expect(body[0].info?.id === "msg_02", `first ${JSON.stringify(body[0]?.info?.id)}`);
    });

    await test("session messages before pages strictly older messages", async () => {
      const { status, body } = await request(
        baseUrl,
        "/session/sess_01/message?limit=1&before=msg_02",
      );
      expect(status === 200, `status ${status}`);
      expect(body.length === 1, `expected 1 entry; got ${body?.length}`);
      expect(body[0].info?.id === "msg_01", `first ${JSON.stringify(body[0]?.info?.id)}`);
    });

    await test("session messages before with an unknown id returns an empty array", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/message?before=msg_nope");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 0, `expected []; got ${JSON.stringify(body)}`);
    });

    await test("session messages page chain has no overlap", async () => {
      const page1 = await request(baseUrl, "/session/sess_01/message?limit=1");
      const ids1 = page1.body.map((m) => m.info?.id);
      const page2 = await request(baseUrl, `/session/sess_01/message?limit=1&before=${ids1[0]}`);
      const ids2 = page2.body.map((m) => m.info?.id);
      expect(
        ids1.length === 1 && ids2.length === 1,
        `pages ${JSON.stringify(ids1)}/${JSON.stringify(ids2)}`,
      );
      const overlap = ids1.filter((id) => ids2.includes(id));
      expect(overlap.length === 0, `overlap ${JSON.stringify(overlap)}`);
    });

    await test("todo returns todo entries", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/todo");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body), "body must be an array");
      const t = body[0];
      expect(typeof t?.content === "string", "first item must have string content");
      expect(typeof t?.status === "string", "first item must have string status");
      expect(typeof t?.priority === "string", "first item must have string priority");
    });

    // TASK-M5-01: /permission family.
    await test("permission list returns pending requests", async () => {
      const { status, body } = await request(baseUrl, "/permission");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length > 0, "body must be a non-empty array");
      const p = body[0];
      expect(typeof p?.id === "string", "request must carry id");
      expect(typeof p?.sessionID === "string", "request must carry sessionID");
      expect(typeof p?.permission === "string", "request must carry permission");
      expect(Array.isArray(p?.patterns), "request must carry patterns");
      expect(Array.isArray(p?.always), "request must carry always");
      expect(typeof p?.tool?.messageID === "string", "request must carry tool context");
    });

    await test("permission reply returns true", async () => {
      const { status, body } = await request(baseUrl, "/permission/per_mock_001/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: "once" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("permission reply accepts always and reject", async () => {
      for (const reply of ["always", "reject"]) {
        const { status } = await request(baseUrl, "/permission/per_mock_001/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply }),
        });
        expect(status === 200, `reply ${reply} -> status ${status}`);
      }
    });

    await test("permission reply rejects an invalid reply", async () => {
      const { status, body } = await request(baseUrl, "/permission/per_mock_001/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: "maybe" }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    // TASK-M5-02: /question family.
    await test("question list returns pending questions", async () => {
      const { status, body } = await request(baseUrl, "/question");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length >= 2, "body must have >= 2 requests");
      const q = body[0];
      expect(typeof q?.id === "string" && q.id.startsWith("que_"), "request must carry que_ id");
      expect(typeof q?.sessionID === "string", "request must carry sessionID");
      expect(Array.isArray(q?.questions) && q.questions.length > 0, "request must carry questions");
      const question = q.questions[0];
      expect(typeof question?.question === "string", "question must carry the text");
      expect(typeof question?.header === "string", "question must carry a header");
      expect(Array.isArray(question?.options), "question must carry an options array");
      expect(typeof q?.tool?.messageID === "string", "request must carry tool context");
      // The fixture covers both answer forms: an options question and a
      // free-input question (empty options).
      const freeInput = body.find(
        (r) => Array.isArray(r?.questions?.[0]?.options) && r.questions[0].options.length === 0,
      );
      expect(freeInput !== undefined, "fixture must include a free-input question");
    });

    await test("question reply returns true", async () => {
      const { status, body } = await request(baseUrl, "/question/que_mock_001/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: [["Incremental"]] }),
      });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("question reply accepts a free-input text answer", async () => {
      const { status } = await request(baseUrl, "/question/que_mock_002/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: [["Use the CLI instead"]] }),
      });
      expect(status === 200, `status ${status}`);
    });

    await test("question reply rejects an invalid answers payload", async () => {
      const { status, body } = await request(baseUrl, "/question/que_mock_001/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: "Incremental" }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("question reject returns true", async () => {
      const { status, body } = await request(baseUrl, "/question/que_mock_001/reject", {
        method: "POST",
      });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    // TASK-M5-03: /command family.
    await test("command list returns available slash commands", async () => {
      const { status, body } = await request(baseUrl, "/command");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length >= 3, "body must have >= 3 commands");
      const c = body[0];
      expect(typeof c?.name === "string" && c.name !== "", "command must carry a name");
      expect(typeof c?.template === "string", "command must carry a template");
      expect(Array.isArray(c?.hints), "command must carry a hints array");
      // The fixture covers both forms: a command with an argument hint and
      // one without (custom server commands ride the same list).
      const withHint = body.find((cmd) => Array.isArray(cmd?.hints) && cmd.hints.length > 0);
      expect(withHint !== undefined, "fixture must include a command with an arg hint");
    });

    await test("command run returns the created assistant message", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "init", arguments: "A summary of the codebase" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body?.info?.role === "assistant", `role ${JSON.stringify(body?.info?.role)}`);
      expect(typeof body?.info?.id === "string", "info must carry an id");
      expect(body?.info?.sessionID === "sess_01", "info must echo the session id");
      expect(Array.isArray(body?.parts), "response must carry a parts array");
    });

    await test("command run accepts empty arguments", async () => {
      const { status } = await request(baseUrl, "/session/sess_01/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "compact", arguments: "" }),
      });
      expect(status === 200, `status ${status}`);
    });

    await test("command run rejects an invalid payload", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "init" }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    // TASK-M5-08: /skill family + shell execution.
    await test("skill list returns available skills", async () => {
      const { status, body } = await request(baseUrl, "/skill");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length >= 3, "body must have >= 3 skills");
      for (const skill of body) {
        expect(typeof skill?.name === "string" && skill.name !== "", "skill must carry a name");
        expect(typeof skill?.location === "string", "skill must carry a location");
        expect(typeof skill?.content === "string", "skill must carry a content");
        // The 1.18.11 contract has no hidden flag: every served skill is
        // visible (hidden skills are filtered server-side).
        expect(!("hidden" in (skill ?? {})), "skill schema carries no hidden field");
      }
    });

    await test("shell run returns the created assistant message", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/shell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "ls -la", agent: "build" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body?.info?.role === "assistant", `role ${JSON.stringify(body?.info?.role)}`);
      expect(typeof body?.info?.id === "string", "info must carry an id");
      expect(body?.info?.sessionID === "sess_01", "info must echo the session id");
      expect(Array.isArray(body?.parts) && body.parts.length > 0, "response must carry parts");
      const part = body?.parts?.[0];
      expect(part?.type === "text" && typeof part?.text === "string", "part must be a text part");
    });

    await test("shell run accepts the optional model", async () => {
      const { status } = await request(baseUrl, "/session/sess_01/shell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "git status",
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5" },
        }),
      });
      expect(status === 200, `status ${status}`);
    });

    await test("shell run rejects a payload missing agent or command", async () => {
      const missingAgent = await request(baseUrl, "/session/sess_01/shell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "ls" }),
      });
      expect(missingAgent.status === 400, `status ${missingAgent.status}`);
      const missingCommand = await request(baseUrl, "/session/sess_01/shell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "build" }),
      });
      expect(missingCommand.status === 400, `status ${missingCommand.status}`);
    });

    await test("shell run rejects a malformed model", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/shell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "ls", agent: "build", model: { providerID: "openai" } }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("prompt_async accepts an agent part (AgentPartInput shape)", async () => {
      const { status } = await request(baseUrl, "/session/sess_01/prompt_async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [
            { type: "text", text: "analyze @research" },
            { type: "agent", name: "research" },
          ],
        }),
      });
      expect(status === 204, `status ${status}`);
    });

    await test("prompt_async rejects a malformed part", async () => {
      const { status, body } = await request(baseUrl, "/session/sess_01/prompt_async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: [{ type: "agent" }] }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    // TASK-M5-04: /agent family.
    await test("agent list returns the agent catalog", async () => {
      const { status, body } = await request(baseUrl, "/agent");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length >= 3, "body must have >= 3 agents");
      const build = body.find((a) => a?.name === "build");
      expect(build !== undefined, "fixture must include the build agent");
      expect(typeof build?.description === "string", "agent must carry a description");
      expect(
        ["primary", "subagent", "all"].includes(build?.mode),
        `mode ${JSON.stringify(build?.mode)}`,
      );
      expect(
        typeof build?.color === "string" && build.color.startsWith("#"),
        "agent must carry a hex color",
      );
      expect(Array.isArray(build?.permission), "agent must carry a permission ruleset");
      // The fixture covers the hidden-filter contract: architect is hidden.
      const architect = body.find((a) => a?.name === "architect");
      expect(architect?.hidden === true, "fixture must include a hidden agent");
    });

    // TASK-M5-05: /provider family.
    await test("provider list returns catalog, defaults and connected ids", async () => {
      const { status, body } = await request(baseUrl, "/provider");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body?.all) && body.all.length >= 3, "all must have >= 3 providers");
      const openai = body.all.find((p) => p?.id === "openai");
      expect(openai !== undefined, "fixture must include openai");
      expect(typeof openai?.name === "string" && openai.name !== "", "provider must carry a name");
      expect(
        typeof openai?.models === "object" && openai.models !== null,
        "provider must carry a models record",
      );
      const gpt5 = openai?.models?.["gpt-5"];
      expect(typeof gpt5?.name === "string", "model must carry a name");
      expect(typeof gpt5?.capabilities?.toolcall === "boolean", "model must carry toolcall");
      expect(typeof gpt5?.capabilities?.reasoning === "boolean", "model must carry reasoning");
      expect(
        typeof gpt5?.capabilities?.input?.image === "boolean",
        "model must carry image input capability",
      );
      expect(
        typeof gpt5?.cost?.input === "number" && typeof gpt5?.cost?.output === "number",
        "model must carry numeric cost",
      );
      expect(typeof gpt5?.limit?.context === "number", "model must carry a context limit");
      expect(
        typeof body?.default === "object" && body.default.openai === "gpt-5",
        `default must map openai -> gpt-5; got ${JSON.stringify(body?.default)}`,
      );
      for (const [providerID, modelID] of Object.entries(body?.default ?? {})) {
        const provider = body.all.find((p) => p?.id === providerID);
        expect(
          provider !== undefined && provider?.models?.[modelID] !== undefined,
          `default ${providerID}/${modelID} must reference a real model`,
        );
      }
      expect(Array.isArray(body?.connected), "connected must be an array");
      expect(body?.connected?.includes("openai") === true, "openai must be connected");
      expect(body?.connected?.includes("azure") === false, "azure must stay unconnected");
      // The fixture covers the unconnected-provider contract for the picker.
      const azure = body.all.find((p) => p?.id === "azure");
      expect(
        azure !== undefined && Object.keys(azure?.models ?? {}).length > 0,
        "fixture must include an unconnected provider with models",
      );
    });

    await test("config providers returns the catalog and the same default record", async () => {
      const { status, body } = await request(baseUrl, "/config/providers");
      expect(status === 200, `status ${status}`);
      expect(
        Array.isArray(body?.providers) && body.providers.length >= 3,
        "providers must have >= 3 entries",
      );
      expect(
        typeof body?.default === "object" && body.default.openai === "gpt-5",
        `default must map openai -> gpt-5; got ${JSON.stringify(body?.default)}`,
      );
      const providerList = await request(baseUrl, "/provider");
      expect(
        JSON.stringify(body?.default) === JSON.stringify(providerList.body?.default),
        "config default must match the /provider default record (picker acceptance)",
      );
    });

    // TASK-M9-05: GET/PATCH /config + /global/config, POST /instance/dispose
    // and /global/dispose.
    await test("config get returns the config object with schema keys", async () => {
      const { status, body } = await request(baseUrl, "/config");
      expect(status === 200, `status ${status}`);
      expect(
        typeof body === "object" && body !== null && !Array.isArray(body),
        "must be an object",
      );
      expect(
        typeof body?.model === "string" && body.model !== "",
        `model ${JSON.stringify(body?.model)}`,
      );
      expect(typeof body?.share === "string", `share ${JSON.stringify(body?.share)}`);
      expect(
        ["manual", "auto", "disabled"].includes(body?.share),
        `share enum ${JSON.stringify(body?.share)}`,
      );
      expect(typeof body?.default_agent === "string", "must carry default_agent");
      expect(
        ["ask", "allow", "deny"].includes(body?.permission),
        `permission action ${JSON.stringify(body?.permission)}`,
      );
    });

    await test("config patch merges scalars and nested objects", async () => {
      const before = await request(baseUrl, "/config");
      const { status, body } = await request(baseUrl, "/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share: "auto", mode: { plan: { model: "claude-haiku-4-5" } } }),
      });
      expect(status === 200, `status ${status}`);
      expect(body?.share === "auto", `share ${JSON.stringify(body?.share)}`);
      expect(body?.model === before.body?.model, "unpatched fields must be retained (merge)");
      expect(
        body?.mode?.plan?.model === "claude-haiku-4-5" &&
          body?.mode?.build?.model === before.body?.mode?.build?.model,
        "nested objects must merge, not replace",
      );
      expect(Array.isArray(body?.mode) === false, "mode must stay an object");
    });

    await test("config patch rejects a non-object payload", async () => {
      const { status, body } = await request(baseUrl, "/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(["share"]),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("config patch isolates per-directory project configs", async () => {
      const { status, body } = await request(
        baseUrl,
        "/config?directory=/mock/projects/opencode-labs",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ share: "disabled" }),
        },
      );
      expect(status === 200, `status ${status}`);
      expect(body?.share === "disabled", `labs share ${JSON.stringify(body?.share)}`);
      const defaultConfig = await request(baseUrl, "/config");
      expect(defaultConfig.body?.share === "auto", "default directory must keep its own patch");
    });

    await test("global config get and patch round-trip", async () => {
      const before = await request(baseUrl, "/global/config");
      expect(
        typeof before.body?.autoupdate === "string" || typeof before.body?.autoupdate === "boolean",
        "autoupdate must be bool or 'notify'",
      );
      const { status, body } = await request(baseUrl, "/global/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoupdate: "notify" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body?.autoupdate === "notify", `autoupdate ${JSON.stringify(body?.autoupdate)}`);
      expect(body?.model === before.body?.model, "global merge must retain unpatched fields");
    });

    // TASK-S1-02: the Settings "Add provider" dialog writes dynamic
    // providers through this endpoint — the global config must accept a
    // `provider.<id>` key (ProviderConfig) and merge it like any other
    // nested object.
    await test("global config patch merges a provider entry (TASK-S1-02)", async () => {
      const before = await request(baseUrl, "/global/config");
      const { status, body } = await request(baseUrl, "/global/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: {
            myllm: {
              name: "My LLM",
              options: { baseURL: "https://myllm.example/v1", apiKey: "sk-test" },
            },
          },
        }),
      });
      expect(status === 200, `status ${status}`);
      expect(body?.provider?.myllm?.name === "My LLM", "provider name must merge");
      expect(
        body?.provider?.myllm?.options?.baseURL === "https://myllm.example/v1",
        `provider baseURL ${JSON.stringify(body?.provider?.myllm?.options?.baseURL)}`,
      );
      expect(
        body?.provider?.myllm?.options?.apiKey === "sk-test",
        `provider apiKey ${JSON.stringify(body?.provider?.myllm?.options?.apiKey)}`,
      );
      expect(body?.model === before.body?.model, "provider patch must retain other fields");
    });

    await test("instance dispose returns true", async () => {
      const { status, body } = await request(baseUrl, "/instance/dispose", { method: "POST" });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("global dispose returns true", async () => {
      const { status, body } = await request(baseUrl, "/global/dispose", { method: "POST" });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    // TASK-M9-06: MCP family — status list, add, connect/disconnect state
    // transitions, the OAuth trio (start → browser visit → poll / code →
    // callback) and auth removal.
    await test("mcp status lists the fixture servers with their shapes", async () => {
      const { status, body } = await request(baseUrl, "/mcp");
      expect(status === 200, `status ${status}`);
      expect(
        body?.filesystem?.status === "connected",
        `filesystem ${JSON.stringify(body?.filesystem)}`,
      );
      expect(
        body?.fetch?.status === "failed" && typeof body?.fetch?.error === "string",
        `fetch ${JSON.stringify(body?.fetch)}`,
      );
      expect(body?.legacy?.status === "disabled", `legacy ${JSON.stringify(body?.legacy)}`);
      expect(body?.github?.status === "needs_auth", `github ${JSON.stringify(body?.github)}`);
    });

    await test("mcp add registers local and remote servers as disabled", async () => {
      const local = await request(baseUrl, "/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "st-local",
          config: {
            type: "local",
            command: ["npx", "-y", "some-mcp"],
            environment: { API_KEY: "k" },
          },
        }),
      });
      expect(local.status === 200, `local add status ${local.status}`);
      expect(
        local.body?.stLocal?.status === "disabled" ||
          local.body?.["st-local"]?.status === "disabled",
        `st-local added ${JSON.stringify(local.body?.["st-local"] ?? local.body?.stLocal)}`,
      );

      const remote = await request(baseUrl, "/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "st-remote",
          config: { type: "remote", url: "https://mcp.example.com/sse" },
        }),
      });
      expect(remote.status === 200, `remote add status ${remote.status}`);
      expect(
        remote.body?.["st-remote"]?.status === "disabled",
        `st-remote added ${JSON.stringify(remote.body?.["st-remote"])}`,
      );
    });

    await test("mcp add rejects missing fields", async () => {
      const noName = await request(baseUrl, "/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { type: "local", command: ["npx"] } }),
      });
      expect(noName.status === 400, `missing name status ${noName.status}`);
      const noCommand = await request(baseUrl, "/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "st-bad", config: { type: "local" } }),
      });
      expect(noCommand.status === 400, `missing command status ${noCommand.status}`);
      const noUrl = await request(baseUrl, "/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "st-bad", config: { type: "remote" } }),
      });
      expect(noUrl.status === 400, `missing url status ${noUrl.status}`);
    });

    await test("mcp connect transitions a disabled server to connected and disconnect back", async () => {
      const connect = await request(baseUrl, "/mcp/st-local/connect", { method: "POST" });
      expect(
        connect.status === 200 && connect.body === true,
        `connect ${JSON.stringify(connect.body)}`,
      );
      const after = await request(baseUrl, "/mcp");
      expect(
        after.body?.["st-local"]?.status === "connected",
        `st-local after connect ${JSON.stringify(after.body?.["st-local"])}`,
      );

      const disconnect = await request(baseUrl, "/mcp/st-local/disconnect", { method: "POST" });
      expect(
        disconnect.status === 200 && disconnect.body === true,
        `disconnect ${disconnect.body}`,
      );
      const final = await request(baseUrl, "/mcp");
      expect(
        final.body?.["st-local"]?.status === "disabled",
        `st-local after disconnect ${JSON.stringify(final.body?.["st-local"])}`,
      );
    });

    await test("mcp connect heals a failed server and disconnect marks it disabled", async () => {
      await request(baseUrl, "/mcp/fetch/connect", { method: "POST" });
      const connected = await request(baseUrl, "/mcp");
      expect(
        connected.body?.fetch?.status === "connected",
        `fetch after connect ${JSON.stringify(connected.body?.fetch)}`,
      );
      await request(baseUrl, "/mcp/fetch/disconnect", { method: "POST" });
      const disabled = await request(baseUrl, "/mcp");
      expect(
        disabled.body?.fetch?.status === "disabled",
        `fetch after disconnect ${JSON.stringify(disabled.body?.fetch)}`,
      );
    });

    await test("mcp connect / disconnect on an unknown server is 404", async () => {
      const connect = await request(baseUrl, "/mcp/ghost/connect", { method: "POST" });
      expect(connect.status === 404, `connect status ${connect.status}`);
      expect(
        connect.body?._tag === "McpServerNotFoundError",
        `connect body ${JSON.stringify(connect.body)}`,
      );
      const disconnect = await request(baseUrl, "/mcp/ghost/disconnect", { method: "POST" });
      expect(disconnect.status === 404, `disconnect status ${disconnect.status}`);
    });

    await test("mcp oauth auto flow: start → authorize page visit → authenticate poll → connected", async () => {
      const start = await request(baseUrl, "/mcp/github/auth", { method: "POST" });
      expect(start.status === 200, `auth start status ${start.status}`);
      expect(
        typeof start.body?.authorizationUrl === "string" &&
          typeof start.body?.oauthState === "string",
        `auth start body ${JSON.stringify(start.body)}`,
      );
      expect(
        start.body?.authorizationUrl?.includes("/mcp/oauth/authorize?state="),
        `authorizationUrl ${start.body?.authorizationUrl}`,
      );

      // The pending poll answers needs_auth until the browser visits the page.
      const pending = await request(baseUrl, "/mcp/github/auth/authenticate?poll=1", {
        method: "POST",
      });
      expect(pending.body?.status === "needs_auth", `pending poll ${JSON.stringify(pending.body)}`);

      const state = start.body.oauthState;
      const visited = await request(baseUrl, `/mcp/oauth/authorize?state=${state}`);
      expect(visited.status === 200, `authorize page status ${visited.status}`);

      const done = await request(baseUrl, "/mcp/github/auth/authenticate?poll=1", {
        method: "POST",
      });
      expect(done.body?.status === "connected", `completed poll ${JSON.stringify(done.body)}`);
      const list = await request(baseUrl, "/mcp");
      expect(list.body?.github?.status === "connected", "github list status after flow");
    });

    await test("mcp oauth code flow: callback with the fixed code connects, a wrong code is 400", async () => {
      await request(baseUrl, "/mcp/github/auth", { method: "POST" });
      const ok = await request(baseUrl, "/mcp/github/auth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "mock-oauth-code" }),
      });
      expect(ok.status === 200, `callback status ${ok.status}`);
      expect(ok.body?.status === "connected", `callback body ${JSON.stringify(ok.body)}`);

      const bad = await request(baseUrl, "/mcp/github/auth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "nope" }),
      });
      expect(bad.status === 400, `wrong code status ${bad.status}`);
    });

    await test("mcp oauth rejects servers without OAuth support", async () => {
      const start = await request(baseUrl, "/mcp/filesystem/auth", { method: "POST" });
      expect(start.status === 400, `start status ${start.status}`);
      const poll = await request(baseUrl, "/mcp/filesystem/auth/authenticate?poll=1", {
        method: "POST",
      });
      expect(poll.status === 400, `authenticate status ${poll.status}`);
    });

    await test("mcp oauth removal reports success and revokes the authorization", async () => {
      const { status, body } = await request(baseUrl, "/mcp/github/auth", { method: "DELETE" });
      expect(status === 200, `status ${status}`);
      expect(body?.success === true, `body ${JSON.stringify(body)}`);
      const list = await request(baseUrl, "/mcp");
      expect(
        list.body?.github?.status === "needs_auth",
        `github needs authorization again ${JSON.stringify(list.body?.github)}`,
      );
    });

    // TASK-M9-07: status bar (LSP + formatter shapes), log forwarding
    // (POST /log validation), saved permission rules (list + remove) and
    // the display-only global upgrade endpoint.
    await test("lsp status lists the fixture servers with their shapes", async () => {
      const { status, body } = await request(baseUrl, "/lsp");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 3, `lsp list ${JSON.stringify(body)}`);
      const connected = body.filter((entry) => entry.status === "connected");
      expect(connected.length === 2, `connected count ${connected.length}`);
      for (const entry of body) {
        expect(typeof entry?.id === "string", `id ${JSON.stringify(entry?.id)}`);
        expect(typeof entry?.name === "string", `name ${JSON.stringify(entry?.name)}`);
        expect(typeof entry?.root === "string", `root ${JSON.stringify(entry?.root)}`);
        expect(
          ["connected", "error"].includes(entry?.status),
          `status ${JSON.stringify(entry?.status)}`,
        );
      }
    });

    await test("formatter status lists enabled/disabled formatters", async () => {
      const { status, body } = await request(baseUrl, "/formatter");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length === 2, `formatter list ${JSON.stringify(body)}`);
      const enabled = body.filter((entry) => entry.enabled === true);
      expect(enabled.length === 1, `enabled count ${enabled.length}`);
      expect(
        Array.isArray(body[0]?.extensions) && typeof body[0]?.name === "string",
        "formatter shape must carry name + extensions",
      );
    });

    await test("log accepts a valid entry and returns true", async () => {
      const { status, body } = await request(baseUrl, "/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "opencoder-webview",
          level: "error",
          message: "test error from the diagnostics console",
        }),
      });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("log rejects entries missing the required fields", async () => {
      const noService = await request(baseUrl, "/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: "error", message: "x" }),
      });
      expect(noService.status === 400, `missing service status ${noService.status}`);
      const noLevel = await request(baseUrl, "/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: "s", message: "x", level: "fatal" }),
      });
      expect(noLevel.status === 400, `invalid level status ${noLevel.status}`);
      const noMessage = await request(baseUrl, "/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: "s", level: "info" }),
      });
      expect(noMessage.status === 400, `missing message status ${noMessage.status}`);
    });

    await test("saved permission rules list carries the fixture envelope", async () => {
      const { status, body } = await request(baseUrl, "/api/permission/saved");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body?.data) && body.data.length === 3, `rules ${JSON.stringify(body)}`);
      for (const rule of body.data) {
        expect(typeof rule?.id === "string", `rule id ${JSON.stringify(rule?.id)}`);
        expect(typeof rule?.projectID === "string", `projectID ${JSON.stringify(rule?.projectID)}`);
        expect(typeof rule?.action === "string", `action ${JSON.stringify(rule?.action)}`);
        expect(typeof rule?.resource === "string", `resource ${JSON.stringify(rule?.resource)}`);
      }
    });

    await test("saved permission remove answers 204 and shrinks the list", async () => {
      const before = await request(baseUrl, "/api/permission/saved");
      const target = before.body?.data?.[0]?.id;
      expect(typeof target === "string" && target !== "", `target ${JSON.stringify(target)}`);
      const removed = await request(baseUrl, `/api/permission/saved/${target}`, {
        method: "DELETE",
      });
      expect(removed.status === 204, `remove status ${removed.status}`);
      const after = await request(baseUrl, "/api/permission/saved");
      expect(
        Array.isArray(after.body?.data) && after.body.data.length === before.body.data.length - 1,
        `list shrank ${JSON.stringify(after.body?.data?.length)}`,
      );
      expect(
        after.body.data.every((rule) => rule.id !== target),
        `removed rule absent ${JSON.stringify(after.body.data.map((rule) => rule.id))}`,
      );
      // A second delete of the same id still answers 204 (contract).
      const again = await request(baseUrl, `/api/permission/saved/${target}`, {
        method: "DELETE",
      });
      expect(again.status === 204, `second remove status ${again.status}`);
    });

    await test("global upgrade answers the success result shape", async () => {
      const { status, body } = await request(baseUrl, "/global/upgrade", { method: "POST" });
      expect(status === 200, `status ${status}`);
      expect(
        body?.success === true && typeof body?.version === "string",
        `body ${JSON.stringify(body)}`,
      );
    });

    // TASK-M5-06: /provider/auth + PUT/DELETE /auth/{providerID}.
    await test("provider auth returns the per-provider auth methods", async () => {
      const { status, body } = await request(baseUrl, "/provider/auth");
      expect(status === 200, `status ${status}`);
      expect(
        typeof body === "object" && body !== null && !Array.isArray(body),
        "body must be a record keyed by provider id",
      );
      expect(Array.isArray(body?.openai) && body.openai.length > 0, "openai must carry methods");
      const openai = body.openai[0];
      expect(
        ["oauth", "api"].includes(openai?.type),
        `method type ${JSON.stringify(openai?.type)}`,
      );
      expect(typeof openai?.label === "string" && openai.label !== "", "method must carry a label");
      // The fixture covers both forms: api (openai/anthropic) and oauth (azure).
      expect(
        body?.openai?.some((m) => m?.type === "api") === true,
        "openai must expose the api form",
      );
      expect(
        body?.anthropic?.some((m) => m?.type === "api") === true,
        "anthropic must expose the api form",
      );
      expect(
        body?.azure?.some((m) => m?.type === "oauth") === true,
        "azure must expose the oauth form",
      );
      expect(
        Array.isArray(body?.openai?.[0]?.prompts) && body.openai[0].prompts.length > 0,
        "api method must carry prompts",
      );
    });

    await test("auth set accepts an api-key payload and returns true", async () => {
      const { status, body } = await request(baseUrl, "/auth/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "api", key: "sk-mock-secret" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("auth set rejects a payload without an api key", async () => {
      const { status, body } = await request(baseUrl, "/auth/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "api" }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("auth remove returns true", async () => {
      const { status, body } = await request(baseUrl, "/auth/openai", { method: "DELETE" });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    // TASK-M5-07: provider OAuth flow (auto + code).
    await test("oauth authorize auto returns the browser url, flow and instructions", async () => {
      const { status, body } = await request(baseUrl, "/provider/azure/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: 0 }),
      });
      expect(status === 200, `status ${status}`);
      expect(
        typeof body?.url === "string" && body.url.startsWith("http") && body.url.includes("state="),
        `url ${JSON.stringify(body?.url)}`,
      );
      expect(body?.method === "auto", `flow ${JSON.stringify(body?.method)}`);
      expect(typeof body?.instructions === "string" && body.instructions !== "", "instructions");
    });

    await test("oauth auto poll reports false until the browser completes", async () => {
      const { status, body } = await request(baseUrl, "/provider/azure/oauth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: 0, poll: true }),
      });
      expect(status === 200, `status ${status}`);
      expect(body === false, `pending poll must be false; got ${JSON.stringify(body)}`);
    });

    await test("oauth auto completes when the authorize url is visited", async () => {
      const auth = await request(baseUrl, "/provider/azure/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: 0 }),
      });
      // Visiting the returned URL is the browser round-trip; the real
      // server's local callback listener does this automatically.
      const page = await fetch(auth.body.url);
      expect(page.status === 200, `page status ${page.status}`);
      const html = await page.text();
      expect(html.includes("Authorization complete"), "page must confirm completion");

      const done = await request(baseUrl, "/provider/azure/oauth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: 0, poll: true }),
      });
      expect(done.body === true, `completed poll must be true; got ${JSON.stringify(done.body)}`);
    });

    await test("oauth authorize code flow returns the code method", async () => {
      const { status, body } = await request(baseUrl, "/provider/google/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: 0 }),
      });
      expect(status === 200, `status ${status}`);
      expect(body?.method === "code", `flow ${JSON.stringify(body?.method)}`);
      expect(typeof body?.url === "string", "url must be a string");
    });

    await test("oauth callback accepts a valid code", async () => {
      const { status, body } = await request(baseUrl, "/provider/google/oauth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: 0, code: "mock-oauth-code" }),
      });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("oauth callback rejects an invalid code", async () => {
      const { status, body } = await request(baseUrl, "/provider/google/oauth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: 0, code: "wrong-code" }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("oauth authorize rejects an invalid method index", async () => {
      const { status, body } = await request(baseUrl, "/provider/azure/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: 5 }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    // TASK-M6-01: PTY family (REST part).
    await test("pty list returns Pty entries with required fields", async () => {
      const { status, body } = await request(baseUrl, "/pty");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length >= 2, "body must have >= 2 ptys");
      for (const pty of body) {
        expect(
          typeof pty?.id === "string" && pty.id.startsWith("pty_"),
          `id ${JSON.stringify(pty?.id)}`,
        );
        expect(typeof pty?.title === "string", "pty must carry title");
        expect(typeof pty?.command === "string", "pty must carry command");
        expect(Array.isArray(pty?.args), "pty must carry args");
        expect(typeof pty?.cwd === "string", "pty must carry cwd");
        expect(
          ["running", "exited"].includes(pty?.status),
          `status ${JSON.stringify(pty?.status)}`,
        );
        expect(typeof pty?.pid === "number", "pty must carry pid");
      }
      // The fixture covers both lifecycle states (running + exited with code).
      const exited = body.find((pty) => pty?.status === "exited");
      expect(exited !== undefined, "fixture must include an exited pty");
      expect(typeof exited?.exitCode === "number", "exited pty must carry exitCode");
    });

    await test("pty create returns a running pty honoring the payload", async () => {
      const { status, body } = await request(baseUrl, "/pty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "pnpm", args: ["dev"], cwd: "/tmp", title: "dev server" }),
      });
      expect(status === 200, `status ${status}`);
      expect(typeof body?.id === "string", "created pty must carry id");
      expect(body?.command === "pnpm", `command ${JSON.stringify(body?.command)}`);
      expect(
        JSON.stringify(body?.args) === JSON.stringify(["dev"]),
        `args ${JSON.stringify(body?.args)}`,
      );
      expect(body?.cwd === "/tmp", `cwd ${JSON.stringify(body?.cwd)}`);
      expect(body?.title === "dev server", `title ${JSON.stringify(body?.title)}`);
      expect(body?.status === "running", `status ${JSON.stringify(body?.status)}`);
    });

    await test("pty create accepts a bare payload (default shell)", async () => {
      const { status, body } = await request(baseUrl, "/pty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(status === 200, `status ${status}`);
      expect(typeof body?.command === "string" && body.command !== "", "command must default");
      expect(body?.status === "running", `status ${JSON.stringify(body?.status)}`);
    });

    await test("pty get returns the fixture entry", async () => {
      const { status, body } = await request(baseUrl, "/pty/pty_abc123");
      expect(status === 200, `status ${status}`);
      expect(body?.id === "pty_abc123", `id ${JSON.stringify(body?.id)}`);
      expect(body?.status === "running", `status ${JSON.stringify(body?.status)}`);
    });

    await test("pty get of an unknown id is a 404 PtyNotFoundError", async () => {
      const { status, body } = await request(baseUrl, "/pty/pty_nope");
      expect(status === 404, `status ${status}`);
      expect(body?._tag === "PtyNotFoundError", `_tag ${JSON.stringify(body?._tag)}`);
      expect(typeof body?.message === "string", "404 must carry a message");
    });

    await test("pty update resizes via the size body", async () => {
      const { status, body } = await request(baseUrl, "/pty/pty_abc123", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size: { rows: 40, cols: 120 } }),
      });
      expect(status === 200, `status ${status}`);
      expect(body?.id === "pty_abc123", `id ${JSON.stringify(body?.id)}`);
    });

    await test("pty update rejects a malformed size", async () => {
      const { status, body } = await request(baseUrl, "/pty/pty_abc123", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size: { rows: 0, cols: 120 } }),
      });
      expect(status === 400, `status ${status}`);
      expect(typeof body?.message === "string", "400 must carry an error message");
    });

    await test("pty update of an unknown id is a 404", async () => {
      const { status } = await request(baseUrl, "/pty/pty_nope", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      });
      expect(status === 404, `status ${status}`);
    });

    await test("pty delete returns true", async () => {
      const { status, body } = await request(baseUrl, "/pty/pty_abc124", { method: "DELETE" });
      expect(status === 200, `status ${status}`);
      expect(body === true, `body ${JSON.stringify(body)}`);
    });

    await test("pty shells returns path/name/acceptable entries", async () => {
      const { status, body } = await request(baseUrl, "/pty/shells");
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body) && body.length >= 2, "body must have >= 2 shells");
      for (const shell of body) {
        expect(
          typeof shell?.path === "string" && shell.path.startsWith("/"),
          `path ${JSON.stringify(shell?.path)}`,
        );
        expect(
          typeof shell?.name === "string" && shell.name !== "",
          `name ${JSON.stringify(shell?.name)}`,
        );
        expect(
          typeof shell?.acceptable === "boolean",
          `acceptable ${JSON.stringify(shell?.acceptable)}`,
        );
      }
      // The fixture covers both acceptable and non-acceptable shells.
      expect(
        body.some((shell) => shell.acceptable === true),
        "fixture must include acceptable shells",
      );
      expect(
        body.some((shell) => shell.acceptable === false),
        "fixture must include non-acceptable shells",
      );
    });

    await test("pty connect-token returns the PtyTicketConnectToken shape", async () => {
      const { status, body } = await request(baseUrl, "/pty/pty_abc123/connect-token", {
        method: "POST",
      });
      expect(status === 200, `status ${status}`);
      expect(
        typeof body?.ticket === "string" && body.ticket !== "",
        `ticket ${JSON.stringify(body?.ticket)}`,
      );
      expect(
        typeof body?.expires_in === "number" && body.expires_in > 0,
        `expires_in ${JSON.stringify(body?.expires_in)}`,
      );
    });

    await test("pty connect answers 426 with the websocket note", async () => {
      const { status, body } = await request(baseUrl, "/pty/pty_abc123/connect?ticket=t-1");
      expect(status === 426, `status ${status}`);
      expect(
        typeof body?.message === "string" && body.message.includes("WebSocket"),
        "426 must explain the websocket upgrade",
      );
      expect(body?.ticket === "t-1", `ticket must echo back; got ${JSON.stringify(body?.ticket)}`);
    });

    // TASK-M6-01: the PTY WebSocket data channel, simulated by the
    // standalone ws-echo server (the express mock cannot upgrade natively).
    await test("pty ws: ws-echo server echoes a binary frame", async () => {
      const wsPort = randomPort();
      const echo = spawn("node", ["tests/mock-server/ws-echo.mjs", "--port", String(wsPort)], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("ws-echo did not start")), 5000);
          echo.stdout.on("data", (chunk) => {
            if (String(chunk).includes("listening")) {
              clearTimeout(timer);
              resolve();
            }
          });
          echo.on("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`ws-echo exited early (code ${code})`));
          });
        });
        const { WebSocket } = await import("ws");
        const echoed = await new Promise((resolve, reject) => {
          const socket = new WebSocket(`ws://localhost:${wsPort}`);
          const timer = setTimeout(() => reject(new Error("ws echo round trip timed out")), 5000);
          socket.on("open", () =>
            socket.send(Buffer.from([0x1b, 0x5b, 0x33, 0x32, 0x6d, 0x68, 0x69])),
          );
          socket.on("message", (data) => {
            clearTimeout(timer);
            resolve(data);
            socket.close();
          });
          socket.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });
        const bytes = [...Buffer.from(echoed)];
        expect(
          JSON.stringify(bytes) === JSON.stringify([0x1b, 0x5b, 0x33, 0x32, 0x6d, 0x68, 0x69]),
          `echo mismatch: ${JSON.stringify(bytes)}`,
        );
      } finally {
        echo.kill("SIGTERM");
      }
    });

    await test("unimplemented endpoint returns 501", async () => {
      const { status, body } = await request(baseUrl, "/model");
      expect(status === 501, `status ${status}`);
      expect(body.error === "not implemented", `error ${JSON.stringify(body.error)}`);
    });

    await test("__fail=500 injects 500", async () => {
      const { status, body } = await request(baseUrl, "/session?__fail=500");
      expect(status === 500, `status ${status}`);
      expect(body.error === "500 injected", `error ${JSON.stringify(body.error)}`);
    });

    await test("__slow=300 delays response", async () => {
      const start = Date.now();
      const { status } = await request(baseUrl, "/session?__slow=300");
      const elapsed = Date.now() - start;
      expect(status === 200, `status ${status}`);
      expect(elapsed >= 300, `elapsed ${elapsed}ms < 300ms`);
    });

    await test("cors is off by default", async () => {
      const { headers } = await request(baseUrl, "/session", {
        headers: { Origin: "tauri://localhost" },
      });
      expect(headers.get("access-control-allow-origin") === null, "ACAO header must be absent");
    });

    await test("sse: happy-chat streams server.connected first and replays the scenario", async () => {
      const events = await expectScenarioSequence(baseUrl, "happy-chat", [
        "session.status",
        "message.part.updated",
        "message.part.delta",
      ]);
      expect(
        events[0].properties.reconnected === false,
        "server.connected must carry reconnected:false",
      );
      for (const e of events) {
        if (e.properties?.sessionID !== undefined) {
          expect(
            e.properties.sessionID === SESSION_ID,
            `coherent sessionID; got ${JSON.stringify(e.properties.sessionID)}`,
          );
        }
      }
      const toolUpdates = events.filter(
        (e) => e.type === "message.part.updated" && e.properties?.part?.type === "tool",
      );
      expect(toolUpdates.length >= 2, "tool part must be updated for call + result");
      expect(
        toolUpdates[0].properties.part.state.status === "running",
        "first tool part state must be running",
      );
      expect(
        toolUpdates[1].properties.part.state.status === "completed",
        "second tool part state must be completed",
      );
      const todoUpdates = events.filter((e) => e.type === "todo.updated");
      expect(
        todoUpdates.length >= 3,
        `expected >= 3 todo.updated events; got ${todoUpdates.length}`,
      );
      expect(
        Array.isArray(todoUpdates[0].properties.todos) &&
          todoUpdates[0].properties.todos.length === 2,
        "first todo.updated must carry a 2-item todos array",
      );
      expect(
        todoUpdates[0].properties.todos[0].status === "in_progress",
        "first todo must start in_progress",
      );
      const lastTodos = todoUpdates[todoUpdates.length - 1].properties.todos;
      expect(
        Array.isArray(lastTodos) && lastTodos.every((t) => t.status === "completed"),
        "final todo.updated must mark every todo completed",
      );
    });

    await test("sse: permission-flow asks then replies", async () => {
      const events = await expectScenarioSequence(baseUrl, "permission-flow", [
        "permission.asked",
        "permission.replied",
      ]);
      const asked = events.find((e) => e.type === "permission.asked");
      const replied = events.find((e) => e.type === "permission.replied");
      expect(
        asked.properties.id === "per_req_001",
        `permission id ${JSON.stringify(asked.properties.id)}`,
      );
      expect(asked.properties.sessionID === SESSION_ID, "asked must target the scenario session");
      expect(
        replied.properties.requestID === "per_req_001",
        "replied must reference the asked request",
      );
      expect(
        replied.properties.reply === "once",
        `reply ${JSON.stringify(replied.properties.reply)}`,
      );
    });

    await test("sse: question-flow asks then replies", async () => {
      const events = await expectScenarioSequence(baseUrl, "question-flow", [
        "question.asked",
        "question.replied",
      ]);
      const asked = events.find((e) => e.type === "question.asked");
      const replied = events.find((e) => e.type === "question.replied");
      expect(
        Array.isArray(asked.properties.questions) && asked.properties.questions.length > 0,
        "asked must carry questions",
      );
      expect(
        asked.properties.questions[0].header === "Refactor approach",
        "first question must have a header",
      );
      expect(
        replied.properties.requestID === "que_req_001",
        "replied must reference the asked request",
      );
      expect(
        JSON.stringify(replied.properties.answers) === JSON.stringify(["Incremental"]),
        "answers must match the reply",
      );
    });

    await test("sse: sse-drop ends the stream without a terminal event", async () => {
      const events = await collectSSE(baseUrl, "/event?scenario=sse-drop", () => false, {
        timeoutMs: 8000,
      });
      const types = typesOf(events);
      expect(types[0] === "server.connected", `first event ${types[0]}`);
      expect(types.length >= 3, `expected a few events before the drop; got ${types.join(", ")}`);
      expect(!types.includes("session.idle"), "sse-drop must not emit session.idle");
    });

    await test("sse: __drop=true ends happy-chat early without session.idle", async () => {
      const events = await collectSSE(
        baseUrl,
        "/event?scenario=happy-chat&__drop=true",
        () => false,
        { timeoutMs: 8000 },
      );
      const types = typesOf(events);
      expect(types[0] === "server.connected", `first event ${types[0]}`);
      expect(types.includes("session.created"), "must still replay the first scenario event");
      expect(
        !types.includes("session.idle"),
        "__drop must cut the stream before the terminal event",
      );
    });

    await test("sse: /global/event streams GlobalEvent envelopes", async () => {
      const events = await collectSSE(baseUrl, "/global/event", (evts) =>
        evts.some((e) => e.payload?.type === "catalog.updated"),
      );
      const types = typesOf(events);
      expect(types[0] === "server.connected", `first event ${types[0]}`);
      expect(types[1] === "project.updated", `second event ${types[1]}`);
      expect(
        events[1].directory === "/mock/projects/opencode-demo",
        "global envelope must carry the directory",
      );
      expect(
        events[1].payload?.properties?.id === "project-mock-1",
        "payload properties must carry the project id",
      );
    });
  }

  await test("fixture mode: MOCK_FIXTURES_DIR serves the recorded fixtures (tests/fixtures)", async () => {
    const port = randomPort();
    const server = startServer(["--port", String(port)], {
      env: { MOCK_FIXTURES_DIR: "tests/fixtures" },
    });
    servers.push(server);
    const fixtureUrl = `http://localhost:${port}`;
    await waitForReady(fixtureUrl, server);

    const { status, body } = await request(fixtureUrl, "/session");
    expect(status === 200, `status ${status}`);
    expect(
      body[0]?.id === "ses_abc123",
      `first session id ${JSON.stringify(body[0]?.id)} (expected ses_abc123 from tests/fixtures)`,
    );

    const detail = await request(fixtureUrl, "/session/ses_abc123");
    expect(detail.status === 200, `detail status ${detail.status}`);
    expect(detail.body?.id === "ses_abc123", `detail id ${JSON.stringify(detail.body?.id)}`);

    // The recorded root maps file.tree and session.diff; the remaining M4
    // routes fall back to the built-in mock fixtures.
    const fileList = await request(fixtureUrl, "/file");
    expect(
      Array.isArray(fileList.body) && fileList.body.length > 0,
      "file tree must serve in fixture mode",
    );
    expect(
      typeof fileList.body[0]?.absolute === "string",
      "recorded FileNode must carry an absolute path",
    );
    const sessionDiff = await request(fixtureUrl, "/session/ses_abc123/diff");
    expect(
      Array.isArray(sessionDiff.body) && sessionDiff.body.length > 0,
      "session diff must serve in fixture mode",
    );
    expect(typeof sessionDiff.body[0]?.file === "string", "recorded diff entry must carry a file");

    // The recorded root maps permission.asked onto the /permission list
    // (TASK-M5-01).
    const permission = await request(fixtureUrl, "/permission");
    expect(
      Array.isArray(permission.body) && permission.body.length > 0,
      "permission list must serve in fixture mode",
    );
    expect(
      permission.body[0]?.id === "per_abc123",
      `recorded permission id ${JSON.stringify(permission.body[0]?.id)}`,
    );

    // The recorded root maps question.asked onto the /question list
    // (TASK-M5-02).
    const question = await request(fixtureUrl, "/question");
    expect(
      Array.isArray(question.body) && question.body.length > 0,
      "question list must serve in fixture mode",
    );
    expect(
      question.body[0]?.id === "que_abc123",
      `recorded question id ${JSON.stringify(question.body[0]?.id)}`,
    );

    // The recorded root carries no provider fixtures, so /provider falls
    // back to the built-in catalog (TASK-M5-05).
    const provider = await request(fixtureUrl, "/provider");
    expect(
      Array.isArray(provider.body?.all) && provider.body.all.length > 0,
      "provider catalog must serve in fixture mode",
    );
    expect(
      provider.body?.connected?.includes("openai") === true,
      "fixture-mode provider list must mark openai connected",
    );
  });

  // ---- Server with auth + cors ----
  {
    const port = randomPort();
    const server = startServer(["--port", String(port), "--cors", "--auth-password", "secret"]);
    servers.push(server);
    const authUrl = `http://localhost:${port}`;
    await waitForReady(authUrl, server);

    const basic = (password) => `Basic ${Buffer.from(`user:${password}`).toString("base64")}`;

    await test("auth: 401 without credentials", async () => {
      const { status, body, headers } = await request(authUrl, "/session");
      expect(status === 401, `status ${status}`);
      expect(body.error === "unauthorized", `error ${JSON.stringify(body.error)}`);
      expect(
        (headers.get("www-authenticate") ?? "").startsWith("Basic"),
        "WWW-Authenticate must challenge Basic",
      );
    });

    await test("auth: 401 with wrong password", async () => {
      const { status } = await request(authUrl, "/session", {
        headers: { Authorization: basic("wrong") },
      });
      expect(status === 401, `status ${status}`);
    });

    await test("auth: 200 with correct password", async () => {
      const { status, body } = await request(authUrl, "/session", {
        headers: { Authorization: basic("secret") },
      });
      expect(status === 200, `status ${status}`);
      expect(Array.isArray(body), "body must be an array");
    });

    await test("cors: allowed tauri origin is reflected", async () => {
      const { headers } = await request(authUrl, "/session", {
        headers: { Authorization: basic("secret"), Origin: "tauri://localhost" },
      });
      expect(
        headers.get("access-control-allow-origin") === "tauri://localhost",
        "ACAO must reflect the origin",
      );
    });

    await test("cors: disallowed origin gets no header", async () => {
      const { headers } = await request(authUrl, "/session", {
        headers: { Authorization: basic("secret"), Origin: "http://evil.example" },
      });
      expect(headers.get("access-control-allow-origin") === null, "ACAO header must be absent");
    });

    await test("cors: preflight OPTIONS returns 204", async () => {
      const res = await fetch(`${authUrl}/session`, {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:1420", "Access-Control-Request-Method": "GET" },
      });
      expect(res.status === 204, `status ${res.status}`);
      expect(
        res.headers.get("access-control-allow-origin") === "http://localhost:1420",
        "ACAO must reflect the origin",
      );
    });
  }
} catch (err) {
  failed += 1;
  console.error(`FAIL harness: ${err.message}`);
} finally {
  await shutdown(servers);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
