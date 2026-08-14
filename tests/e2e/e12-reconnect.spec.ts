// E12 — Network drop → reconnect → session state auto-aligns
// (testing.md §3 L4: a mid-stream connection drop, the health monitor
// observing the outage, EventSource reconnecting, and the server.connected
// re-sync realigning the session state.)
//
// Mock semantics: the sse-drop scenario plays a few events then closes the
// connection; the browser EventSource auto-reconnects and the mock replays
// the scenario per new connection, which re-triggers server.connected →
// per-server reset + full re-sync (stores/events.ts). The health leg is
// driven by aborting /global/health with a Playwright route — the shim's
// health monitor emits "down" and recovers once the route is removed.

import {
  addServer,
  enterWorkspace,
  expect,
  expectShimAtLeast,
  gotoHome,
  test,
  useScenario,
} from "./fixtures";

test("E12 network drop reconnects and realigns session state", async ({ page }) => {
  await useScenario(page, "sse-drop");
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // The sse-drop scenario streams one text part before dropping.
  await expect(page.getByTestId("workspace-session-ses_abc123")).toBeVisible();
  await page.getByTestId("workspace-session-ses_abc123").click();
  await expect(page.getByTestId("message-list")).toContainText("Working on it", {
    timeout: 10_000,
  });

  // ---- Drop: cut the health endpoint too ----
  await page.route("**/global/health**", (route) => route.abort());

  // The health monitor observes the outage (shim telemetry) and the
  // session data survives in memory while the stream reconnects.
  await expectShimAtLeast(page, ["healthFails", "srv-1"], 1);

  // The server home reflects the outage: the card dot turns red.
  await page.getByTestId("back-to-servers").click();
  await expect(page.getByTestId("server-home")).toBeVisible();
  await expect(page.locator('[data-testid="status-dot"][data-status="down"]')).toBeVisible({
    timeout: 10_000,
  });

  // ---- Reconnect: restore the network ----
  await page.unroute("**/global/health**");
  await expect(page.locator('[data-testid="status-dot"][data-status="ok"]')).toBeVisible({
    timeout: 15_000,
  });

  // Re-enter the workspace: the EventSource reconnects, server.connected
  // re-syncs the stores and the session state realigns (fixture sessions +
  // the scenario's streamed content all present again).
  await enterWorkspace(page);
  await expect(page.getByTestId("workspace-session-sess_01")).toBeVisible();
  await expect(page.getByTestId("workspace-session-ses_abc123")).toBeVisible();
  await page.getByTestId("workspace-session-ses_abc123").click();
  await expect(page.getByTestId("message-list")).toContainText("Working on it", {
    timeout: 15_000,
  });
});
