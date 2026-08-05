// E05 — Permission request appears → allow (remember) → no further prompts
// (testing.md §3 L4: the permission-flow scenario asks for a bash
// permission; "Allow always" (the remember variant) replies, the sheet
// drains and the session continues to idle.)
//
// Mock semantics: the scenario auto-replies server-side at 900ms, so the
// journey must click within the asked(400ms)→replied(900ms) window; the
// the "no further prompts" claim is the mock's single-ask-per-scenario
// behavior, covered
// by the drain assertion + the session continuing without further prompts.

import {
  addServer,
  enterWorkspace,
  expect,
  gotoHome,
  test,
  useScenario,
  waitForMockRequest,
} from "./fixtures";

test("E05 permission request: allow always (remember), flow continues", async ({ page }) => {
  await useScenario(page, "permission-flow");
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // Open the scenario's session (created at stream start) so the composer
  // reflects its busy/idle state.
  await expect(page.getByTestId("session-item-ses_abc123")).toBeVisible();
  await page.getByTestId("session-item-ses_abc123").click();
  await expect(page.getByTestId("message-list")).toBeVisible();

  // permission.asked lands ~650ms after the stream opens (250ms syncDelay
  // + the scenario's 400ms offset).
  await expect(page.getByTestId("permission-sheet")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("permission-type")).toHaveText("bash");
  await expect(page.getByTestId("permission-patterns")).toContainText("ls");

  // Allow always ("remember"): the reply POST carries reply: "always".
  const replyPromise = waitForMockRequest(page, "POST", "/permission/per_req_001/reply");
  await page.getByTestId("permission-allow-always").click();
  const reply = await replyPromise;
  expect(JSON.stringify(reply.body)).toContain('"always"');

  // The permission.replied event drains the queue: the sheet disappears.
  await expect(page.getByTestId("permission-sheet")).toHaveCount(0, { timeout: 10_000 });

  // No further prompt: the session proceeds to idle on its own.
  await expect(
    page
      .getByTestId("session-item-ses_abc123")
      .locator('[data-testid="session-status"][data-status="idle"]'),
  ).toBeVisible({ timeout: 10_000 });
});
