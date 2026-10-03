// E05 — Permission request appears → allow (remember) → request drains
// (testing.md §3 L4: the permission-interactive scenario asks for a bash
// permission; "Allow always" (the remember variant) replies, the sheet
// drains and the session continues to idle.)
//
// The interactive scenario preserves permission-flow's session and idle
// timeline but omits the scheduled reply, allowing the real UI's reply POST
// to drain the request.

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
  await useScenario(page, "permission-interactive");
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // Open the scenario's session (created at stream start) so the composer
  // reflects its busy/idle state.
  await expect(page.getByTestId("workspace-session-ses_abc123")).toBeVisible();
  await page.getByTestId("workspace-session-ses_abc123").click();
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

  // The successful reply POST drains the queue: the sheet disappears.
  await expect(page.getByTestId("permission-sheet")).toHaveCount(0, { timeout: 10_000 });

  // No further prompt: the session proceeds to idle on its own.
  await expect(
    page
      .getByTestId("workspace-session-ses_abc123")
      .locator('[data-testid="workspace-session-status"][data-status="idle"]'),
  ).toBeVisible({ timeout: 10_000 });
});
