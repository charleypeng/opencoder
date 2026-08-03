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

function startServer(args) {
  const child = spawn("pnpm", ["exec", "tsx", "tests/mock-server/index.ts", ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
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
  }

  // ---- Server with auth + cors ----
  {
    const port = randomPort();
    const server = startServer(["--port", String(port), "--cors", "--auth-password", "secret"]);
    servers.push(server);
    const authUrl = `http://localhost:${port}`;
    await waitForReady(authUrl, server);

    const basic = (password) =>
      `Basic ${Buffer.from(`user:${password}`).toString("base64")}`;

    await test("auth: 401 without credentials", async () => {
      const { status, body, headers } = await request(authUrl, "/session");
      expect(status === 401, `status ${status}`);
      expect(body.error === "unauthorized", `error ${JSON.stringify(body.error)}`);
      expect((headers.get("www-authenticate") ?? "").startsWith("Basic"), "WWW-Authenticate must challenge Basic");
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
      expect(headers.get("access-control-allow-origin") === "tauri://localhost", "ACAO must reflect the origin");
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
      expect(res.headers.get("access-control-allow-origin") === "http://localhost:1420", "ACAO must reflect the origin");
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
