// E08 — 文件树打开文件 → 内容渲染；⌘P 快速打开
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

  // The main pane switches to Files and renders the fixture content
  // (shiki-highlighted code arrives asynchronously).
  await expect(page.getByTestId("main-tab-files")).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("file-viewer")).toBeVisible();
  await expect(page.getByTestId("viewer-code")).not.toBeEmpty({ timeout: 15_000 });

  // ⌘/Ctrl+P quick open: type a query and pick the README file.
  await page.keyboard.press("Control+P");
  await expect(page.getByTestId("quick-open-dialog")).toBeVisible();
  await page.getByTestId("quick-open-input").fill("README");
  await expect(page.getByTestId("quick-open-item-README.md")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("quick-open-item-README.md").click();
  await expect(page.getByTestId("viewer-tab-README.md")).toBeVisible();
});
