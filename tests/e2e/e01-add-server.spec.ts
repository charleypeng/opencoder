// E01 — Add server (manual URL) → health check turns green → enter project
// (testing.md §3 L4: add server via the wizard, health turns green, enter
// the workspace.)

import { addServer, enterWorkspace, expect, gotoHome, test } from "./fixtures";

test("E01 add server, health turns green, enter project", async ({ page }) => {
  await gotoHome(page);
  await addServer(page);

  // The shim's health monitor (mirror of the Rust 15s poll, 1.5s tick)
  // reports the mock server healthy: the card dot turns green.
  await expect(page.locator('[data-testid="status-dot"][data-status="ok"]')).toBeVisible();
  await expect(page.getByTestId("health-meta")).toContainText("1.18.11-mock");

  // Clicking the card enters the workspace shell for the server.
  await enterWorkspace(page);
  await expect(page.getByTestId("sidebar-server-name")).toHaveText("Mock Server");
  await expect(page.getByTestId("rail-item-srv-1")).toBeVisible();
});
