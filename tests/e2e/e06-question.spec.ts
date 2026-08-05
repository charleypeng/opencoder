// E06 — Answer the question card → the flow continues
// (testing.md §3 L4: the question-flow scenario asks a multiple-choice
// question; answering it replies to the server and the session continues.)
//
// Mock semantics: the scenario auto-replies at 1000ms, so the journey must
// answer within the asked(400ms)→replied(1000ms) window.

import {
  addServer,
  enterWorkspace,
  expect,
  gotoHome,
  test,
  useScenario,
  waitForMockRequest,
} from "./fixtures";

test("E06 question card answer, flow continues", async ({ page }) => {
  await useScenario(page, "question-flow");
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // Open the scenario's session (created at stream start) so the composer
  // reflects its busy/idle state.
  await expect(page.getByTestId("session-item-ses_abc123")).toBeVisible();
  await page.getByTestId("session-item-ses_abc123").click();
  await expect(page.getByTestId("message-list")).toBeVisible();

  // question.asked lands ~650ms after the stream opens (250ms syncDelay
  // + the scenario's 400ms offset).
  await expect(page.getByTestId("question-sheet")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("question-text")).toContainText(
    "Which approach should I take for the refactor?",
  );

  // Single-select options submit immediately on click.
  const replyPromise = waitForMockRequest(page, "POST", "/question/que_req_001/reply");
  await page.getByTestId("question-option").filter({ hasText: "Incremental" }).click();
  const reply = await replyPromise;
  expect(JSON.stringify(reply.body)).toContain('["Incremental"]');

  // The question.replied event drains the queue; the sheet closes.
  await expect(page.getByTestId("question-sheet")).toHaveCount(0, { timeout: 10_000 });

  // The session proceeds to idle: the composer returns to Send.
  await expect(page.getByTestId("prompt-send")).toBeVisible({ timeout: 10_000 });
  await expect(
    page
      .getByTestId("session-item-ses_abc123")
      .locator('[data-testid="session-status"][data-status="idle"]'),
  ).toBeVisible();
});
