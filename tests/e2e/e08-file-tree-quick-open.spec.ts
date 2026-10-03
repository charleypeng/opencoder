// E08 — File tree opens a file → content renders; ⌘P quick open
// (testing.md §3 L4: the sidebar file tree opens a file into the viewer;
// ⌘/Ctrl+P quick open jumps to another file.)

import { addServer, enterWorkspace, expect, gotoHome, test } from "./fixtures";

test("E08 file tree opens a file; quick open jumps to it", async ({ page }) => {
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // Switch the sidebar to Files and expand src → features → sessions.
  await page.getByTestId("sidebar-view-files").click();
  await expect(page.getByTestId("file-tree")).toBeVisible();
  await page.getByTestId("file-row-src").click();
  await expect(page.getByTestId("file-row-src/features")).toBeVisible();
  await page.getByTestId("file-row-src/features").click();
  await expect(page.getByTestId("file-row-src/features/sessions")).toBeVisible();
  await page.getByTestId("file-row-src/features/sessions").click();
  await page.getByTestId("file-row-src/features/sessions/PromptBox.tsx").click();

  // Opening a file focuses its right-side workbench tab. Highlighted code
  // arrives asynchronously after the file content request resolves.
  const filesPane = page.locator('[data-testid="right-tools-files-pane"]:visible');
  await expect(page.getByTestId("right-tool-panel")).toBeVisible();
  await expect(filesPane.getByTestId("file-viewer")).toBeVisible();
  await expect(filesPane.getByTestId("viewer-code")).not.toBeEmpty({ timeout: 15_000 });

  // ⌘/Ctrl+P quick open: type a query and pick the README file.
  await page.keyboard.press("Control+P");
  await expect(page.getByTestId("quick-open-dialog")).toBeVisible();
  await page.getByTestId("quick-open-input").fill("README");
  await expect(page.getByTestId("quick-open-item-README.md")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("quick-open-item-README.md").click();
  await expect(filesPane).toBeVisible();
  await expect(filesPane.getByTestId("viewer-markdown")).toBeVisible();
  await expect(page.getByRole("tab", { name: "README.md", exact: true })).toBeVisible();
});
