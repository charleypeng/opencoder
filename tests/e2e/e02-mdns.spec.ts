// E02 — mDNS discovery lists a server and one-click add
// (testing.md §3 L4: the nearby-server section lists a discovered server
// and one-click add prefills + probes + saves.)

import { expect, gotoHome, MOCK_URL, test } from "./fixtures";

test("E02 mDNS discovery lists a server and one-click add", async ({ page }) => {
  await gotoHome(page);
  await page.getByTestId("add-first-server").click();
  await expect(page.getByTestId("add-server")).toBeVisible();

  // The shim simulates the Rust mDNS scan: start_mdns_discovery emits one
  // server-discovered event, which lands in the nearby list.
  await expect(page.getByTestId("nearby-mdns-1")).toBeVisible({ timeout: 10_000 });

  // One-click add: prefill name+url and auto-probe.
  await page.getByTestId("add-nearby-mdns-1").click();
  await expect(page.getByTestId("name-input")).toHaveValue("Mock Server (mDNS)");
  await expect(page.getByTestId("url-input")).toHaveValue(MOCK_URL);
  await expect(page.getByTestId("probe-success")).toBeVisible();

  // Saving returns to the grid with the discovered server saved.
  await page.getByTestId("save-server").click();
  await expect(page.getByTestId("server-grid")).toBeVisible();
  await expect(
    page.getByTestId("server-grid").locator('[data-testid^="server-card-"]'),
  ).toHaveCount(1);
});
