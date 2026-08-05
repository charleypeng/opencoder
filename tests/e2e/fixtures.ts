// Shared E2E harness (docs/testing.md §3 L4): installs the Tauri IPC shim
// (tests/e2e/tauri-shim.js) in every page and provides the journey helpers:
// adding the mock server through the real UI, entering the workspace, and
// controlling the mock's SSE stream (hold / scenario selection) so the
// streamed scenarios are deterministic.

import { fileURLToPath } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";

/** Mock OpenCode Server base URL (playwright.config.ts webServer). */
export const MOCK_URL = "http://localhost:14096";

/** The shared test instance: every page gets the Tauri shim up front. */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.addInitScript({
      path: fileURLToPath(new URL("./tauri-shim.js", import.meta.url)),
    });
    await use(page);
  },
});

export { expect };

/** Opens the app (vite dev, fetch transport) at the servers home. */
export async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("server-home")).toBeVisible();
}

/**
 * Adds the mock server via the Add Server wizard: name/url → probe →
 * save → back on the grid with one card. Returns nothing (the shim
 * assigns the registry id).
 */
export async function addServer(page: Page, name = "Mock Server"): Promise<void> {
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await page.getByTestId("add-first-server").click();
  await expect(page.getByTestId("add-server")).toBeVisible();
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("url-input").fill(MOCK_URL);
  await page.getByTestId("test-connection").click();
  await expect(page.getByTestId("probe-success")).toBeVisible();
  await page.getByTestId("save-server").click();
  await expect(page.getByTestId("server-grid")).toBeVisible();
}

/** Clicks the first saved server card and waits for the workspace shell. */
export async function enterWorkspace(page: Page): Promise<void> {
  await page.locator('[data-testid^="server-card-"]').first().click();
  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  // The per-directory SSE stream + re-sync populate the session list.
  await expect(page.getByTestId("session-list")).toBeVisible();
}

/** Opens a session row and waits for the chat transcript. */
export async function openSession(page: Page, sessionId: string): Promise<void> {
  await page.getByTestId(`session-item-${sessionId}`).click();
  await expect(page.getByTestId("message-list")).toBeVisible();
}

/**
 * Holds every `/event` stream request until `release()` is called, so a
 * journey can prepare the UI (add server, open the workspace) before the
 * mock scenario starts playing. The mock streams one scenario per
 * connection, so the timeline begins at release time.
 */
export async function holdEventStream(page: Page): Promise<{ release: () => void }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/event?*", async (route) => {
    await gate;
    await route.continue();
  });
  return { release: () => release() };
}

/**
 * Rewrites every `/event` stream request to the given mock scenario
 * (scenarios/*.ts; the UI never sends a scenario parameter itself, so the
 * default happy-chat would play otherwise).
 */
export async function useScenario(page: Page, scenario: string): Promise<void> {
  await page.route("**/event?*", async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("scenario", scenario);
    await route.continue({ url: url.toString() });
  });
}

/** Reads a counter/telemetry value from the Tauri shim state; arrays are
 *  reported as their length so counters stay comparable. */
export async function shimValue(page: Page, path: string[]): Promise<unknown> {
  return page.evaluate(
    ([segments]) => {
      const state = window.__TAURI_SHIM__?.state;
      let value: unknown = state;
      for (const segment of segments) {
        if (value === null || value === undefined) return undefined;
        value = (value as Record<string, unknown>)[segment];
      }
      return Array.isArray(value) ? value.length : value;
    },
    [path],
  );
}

/** Waits until the shim state counter at `path` reaches at least `min`. */
export async function expectShimAtLeast(page: Page, path: string[], min: number): Promise<void> {
  await expect
    .poll(async () => (await shimValue(page, path)) as number | undefined, {
      timeout: 15_000,
      message: `shim counter ${path.join(".")} >= ${min}`,
    })
    .toBeGreaterThanOrEqual(min);
}

/** Confirms an HTTP request reached the mock server (method + path) and
 *  resolves with its URL and JSON body (undefined when bodyless). */
export function waitForMockRequest(
  page: Page,
  method: string,
  pathPrefix: string,
  timeout = 15_000,
): Promise<{ url: string; body: unknown }> {
  return page
    .waitForRequest(
      (request) => {
        if (request.method() !== method) return false;
        const url = new URL(request.url());
        return url.origin === MOCK_URL && url.pathname.startsWith(pathPrefix);
      },
      { timeout },
    )
    .then((request) => ({ url: request.url(), body: request.postDataJSON() }));
}
