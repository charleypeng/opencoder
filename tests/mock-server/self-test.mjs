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

    await test("unimplemented endpoint returns 501", async () => {
      const { status, body } = await request(baseUrl, "/agent");
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
