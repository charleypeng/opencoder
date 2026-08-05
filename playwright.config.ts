import { defineConfig, devices } from "@playwright/test";

// L4 E2E configuration (docs/testing.md §3 L4): the UI runs under vite dev
// with the dev-only fetch transport (VITE_TRANSPORT=fetch) talking to the
// Mock OpenCode Server (tests/mock-server, CORS enabled). The Tauri IPC
// surface (server registry, health monitor, SSE subscription, PTY channel,
// events) is provided in-browser by the tests/e2e/tauri-shim.js init
// script — there is no Tauri runtime in CI. The 12 journeys (E01–E12)
// live in tests/e2e/*.spec.ts.

export default defineConfig({
  testDir: "./tests/e2e",
  // Two retries in CI (the suite is deterministic; retries cover host jitter
  // on shared runners), zero locally so flakes surface immediately.
  retries: process.env.CI ? 2 : 0,
  // Workers: one at a time locally (the shared mock server + CPU-bound
  // vite dev stay quiet), CI keeps the default parallelism.
  workers: process.env.CI ? undefined : 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Mock OpenCode Server with dev-only CORS (docs/testing.md §2.2).
      command: "pnpm mock:start --cors --port 14096",
      port: 14096,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // vite dev in fetch-transport mode; the fetch client defaults to
      // http://localhost:14096 for the mock (client.ts FETCH_BASE_URL).
      command: "pnpm dev -- --port 1420",
      url: "http://localhost:1420",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        VITE_TRANSPORT: "fetch",
        VITE_MOCK_BASE_URL: "http://localhost:14096",
      },
    },
  ],
});
