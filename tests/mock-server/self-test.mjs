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
      expect(typeof body[0]?.id === "string", "first item must have string id");
      expect(typeof body[0]?.worktree === "string", "first item must have string worktree");
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
