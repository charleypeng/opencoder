// E07 — 会话重命名/删除/搜索
// (testing.md §3 L4: the session search filters the list; the row menu
// renames and deletes a session through the dialogs.)

import { addServer, enterWorkspace, expect, gotoHome, test, waitForMockRequest } from "./fixtures";

test("E07 session search, rename, delete", async ({ page }) => {
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);
  await expect(page.getByTestId("session-item-sess_01")).toBeVisible();

  // Search filters the list by title/slug ("Add form validation" only —
  // "login" would also match the login-form subtree).
  await page.getByTestId("session-search").fill("validation");
  await expect(page.getByTestId("session-item-sess_04")).toBeVisible();
  await expect(page.getByTestId("session-item-sess_01")).toHaveCount(0);
  await expect(page.getByTestId("session-item-sess_02")).toHaveCount(0);
  await page.getByTestId("session-search").fill("");

  // Rename via the row menu (the ⋯ button is hover-revealed).
  await page.getByTestId("session-item-sess_02").hover();
  await page.getByTestId("session-item-sess_02").getByTestId("session-row-menu").click();
  await expect(page.getByTestId("session-menu")).toBeVisible();
  await page.getByTestId("session-menu-rename").click();
  await expect(page.getByTestId("rename-session-dialog")).toBeVisible();
  const renamePromise = waitForMockRequest(page, "PATCH", "/session/sess_02");
  await page.getByTestId("rename-session-input").fill("Renamed session");
  await page.getByTestId("rename-session-save").click();
  await renamePromise;
  await expect(page.getByTestId("rename-session-dialog")).toHaveCount(0);
  await expect(page.getByTestId("session-item-sess_02")).toContainText("Renamed session");

  // Delete via the row menu + confirm dialog.
  await page.getByTestId("session-item-sess_02").hover();
  await page.getByTestId("session-item-sess_02").getByTestId("session-row-menu").click();
  await expect(page.getByTestId("session-menu")).toBeVisible();
  await page.getByTestId("session-menu-delete").click();
  await expect(page.getByTestId("delete-session-dialog")).toBeVisible();
  const deletePromise = waitForMockRequest(page, "DELETE", "/session/sess_02");
  await page.getByTestId("delete-session-confirm").click();
  await deletePromise;
  await expect(page.getByTestId("session-item-sess_02")).toHaveCount(0);
});
