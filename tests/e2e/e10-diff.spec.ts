// E10 — Session diff view shows additions and deletions
// (testing.md §3 L4: the session diff view renders the fixture's per-file
// groups with unified add/del rows, and split mode toggles side by side.)

import { addServer, enterWorkspace, expect, gotoHome, openSession, test } from "./fixtures";

test("E10 session diff view shows additions and deletions", async ({ page }) => {
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // Open a session, then ⌘/Ctrl+D opens the session diff view.
  await openSession(page, "sess_01");
  await page.keyboard.press("Control+D");
  await expect(page.getByTestId("session-diff-view")).toBeVisible();

  // The fixture diff covers 4 files with per-file stats.
  await expect(page.getByTestId("diff-file")).toHaveCount(4, { timeout: 10_000 });
  await expect(
    page.getByTestId("diff-file-header").filter({ hasText: "src/auth/login.ts" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("diff-file-stats").filter({ hasText: "+21" }).filter({ hasText: "-5" }),
  ).toBeVisible();

  // Unified rows carry the added/deleted lines.
  await expect(
    page.getByTestId("diff-row").filter({ hasText: "+export function login" }),
  ).toBeVisible();

  // Split mode renders both sides for the files that carry patch content
  // (the two stats-only entries keep their no-content note).
  await page.getByTestId("diff-mode-split").click();
  await expect(page.getByTestId("diff-split")).toHaveCount(2);
  await expect(page.getByTestId("diff-row")).toHaveCount(0);
});
