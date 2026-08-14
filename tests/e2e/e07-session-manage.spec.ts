// E07 — Session rename/delete/search
// (testing.md §3 L4: the session search filters the workspace tree; the row
// menu renames and deletes a session through the dialogs. The tree lists
// ROOT sessions only — sub-agent children live in the subtask panel — so the
// journey targets the mock's root session sess_01.)

import { addServer, enterWorkspace, expect, gotoHome, test, waitForMockRequest } from "./fixtures";

test("E07 session search, rename, delete", async ({ page }) => {
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);
  await expect(page.getByTestId("workspace-session-ses_rich_01")).toBeVisible();

  // Search filters the tree client-side by folder name / session title.
  // The mock's unused root session is "Heartbeat SSE 与架构讨论（大量消息）":
  // a matching term keeps its folder, a folder-name match keeps the OTHER
  // folder (hiding the demo one), and a non-matching term hides everything.
  await page.getByTestId("workspace-search").fill("Heartbeat");
  await expect(page.getByTestId("workspace-session-ses_rich_01")).toBeVisible();
  await page.getByTestId("workspace-search").fill("labs");
  await expect(page.getByTestId("workspace-session-sess_01")).toHaveCount(0);
  await expect(page.getByTestId("workspace-session-ses_rich_01")).toHaveCount(0);
  await page.getByTestId("workspace-search").fill("no-such-session");
  await expect(page.getByTestId("workspace-session-ses_rich_01")).toHaveCount(0);
  await page.getByTestId("workspace-search").fill("");

  // Rename via the row menu (the ⋯ button is hover-revealed; the menu is
  // located by role — its testid collides with the row's ⋯ button).
  await page.getByTestId("workspace-session-ses_rich_01").hover();
  await page
    .getByTestId("workspace-session-ses_rich_01")
    .getByTestId("workspace-session-menu")
    .click();
  const rowMenu = page.getByRole("menu", { name: "Session actions" });
  await expect(rowMenu).toBeVisible();
  await page.getByTestId("workspace-session-menu-rename").click();
  await expect(page.getByTestId("rename-session-dialog")).toBeVisible();
  const renamePromise = waitForMockRequest(page, "PATCH", "/session/ses_rich_01");
  await page.getByTestId("rename-session-input").fill("Renamed session");
  await page.getByTestId("rename-session-save").click();
  await renamePromise;
  await expect(page.getByTestId("rename-session-dialog")).toHaveCount(0);
  await expect(page.getByTestId("workspace-session-ses_rich_01")).toContainText("Renamed session");

  // Delete via the row menu + confirm dialog. The mock removes the session
  // from its list, so the tree's refresh drops the row for good.
  await page.getByTestId("workspace-session-ses_rich_01").hover();
  await page
    .getByTestId("workspace-session-ses_rich_01")
    .getByTestId("workspace-session-menu")
    .click();
  await expect(rowMenu).toBeVisible();
  await page.getByTestId("workspace-session-menu-delete").click();
  await expect(page.getByTestId("delete-session-dialog")).toBeVisible();
  const deletePromise = waitForMockRequest(page, "DELETE", "/session/ses_rich_01");
  await page.getByTestId("delete-session-confirm").click();
  await deletePromise;
  await expect(page.getByTestId("workspace-session-ses_rich_01")).toHaveCount(0);
});
