// E04 — Interrupt generation → state reset
// (testing.md §3 L4: while the happy-chat scenario is generating, the Stop
// button aborts; the session settles back to idle and the composer and
// streaming progress return to their resting state.)
//
// Mock semantics: the scenario drives busy (150ms) → idle (2600ms) itself,
// so the "state reset" waits for the scenario's idle event after the abort
// POST lands
// (the mock has no abort-driven status flip).

import {
  addServer,
  enterWorkspace,
  expect,
  gotoHome,
  holdEventStream,
  test,
  waitForMockRequest,
} from "./fixtures";

test("E04 interrupt generation returns state to idle", async ({ page }) => {
  const held = await holdEventStream(page);
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // Release the stream and open the scenario's session while it is still
  // generating (busy window: 150ms..2600ms after the stream opens).
  held.release();
  await expect(page.getByTestId("session-item-ses_abc123")).toBeVisible();
  await page.getByTestId("session-item-ses_abc123").click();
  await expect(page.getByTestId("prompt-stop")).toBeVisible({ timeout: 10_000 });

  const abortPromise = waitForMockRequest(page, "POST", "/session/ses_abc123/abort");
  await page.getByTestId("prompt-stop").click();
  await abortPromise;

  // The scenario's idle event flips the busy lock: Send returns, the
  // streaming progress bar is gone, and the row shows idle.
  await expect(page.getByTestId("prompt-send")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("streaming-progress")).toHaveCount(0);
  await expect(
    page
      .getByTestId("session-item-ses_abc123")
      .locator('[data-testid="session-status"][data-status="idle"]'),
  ).toBeVisible();
});
