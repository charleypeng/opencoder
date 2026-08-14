// E03 — New session → send prompt → streamed text+tool render → idle state
// (testing.md §3 L4: create a session, send a prompt through the UI, the
// streamed happy-chat scenario renders text + tool parts, then the session
// settles to idle.)
//
// Mock semantics (documented in docs/tasks/M10.md): prompt_async answers
// 204 and triggers no SSE emission itself; the mock streams its scenario
// per /event connection, so the "send" leg is the optimistic bubble + the
// 204 round trip, and the streaming leg is the happy-chat replay. The
// stream is held until after the send so the scenario never finishes
// before the journey reaches the chat.

import {
  addServer,
  enterWorkspace,
  expect,
  gotoHome,
  holdEventStream,
  test,
  waitForMockRequest,
} from "./fixtures";

test("E03 new session, send prompt, streamed text+tool render, completion", async ({ page }) => {
  const held = await holdEventStream(page);
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // REST sync populates the fixture sessions before the stream plays.
  await expect(page.getByTestId("workspace-session-sess_01")).toBeVisible();

  // Create a session through the sidebar: the header "+" creates it
  // directly in the current working directory (no picker dialog).
  await page.getByTestId("workspace-new-session").click();
  await expect(page.getByTestId("prompt-input")).toBeVisible();
  await page.getByTestId("prompt-input").fill("Explain the codebase");
  const sentPromise = waitForMockRequest(page, "POST", "/session/sess_created/prompt_async");
  await page.getByTestId("prompt-send").click();

  // Optimistic user bubble renders before the 204 round trip resolves.
  await expect(page.getByTestId("message-list")).toContainText("Explain the codebase");
  await sentPromise;

  // Release the stream: happy-chat creates ses_abc123 and streams
  // text deltas + a bash tool call + todos, ending in idle.
  held.release();
  await expect(page.getByTestId("workspace-session-ses_abc123")).toBeVisible();
  await page.getByTestId("workspace-session-ses_abc123").click();
  await expect(page.getByTestId("message-list")).toContainText("Hello! I can help with that.", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("message-list")).toContainText(
    "Found 3 files. I will summarize them for you.",
  );
  await expect(page.getByTestId("tool-part")).toBeVisible();

  // Completion: the row status returns to idle and the composer restores
  // the Send button.
  await expect(
    page
      .getByTestId("workspace-session-ses_abc123")
      .locator('[data-testid="workspace-session-status"][data-status="idle"]'),
  ).toBeVisible();
  await expect(page.getByTestId("prompt-send")).toBeVisible();
});
