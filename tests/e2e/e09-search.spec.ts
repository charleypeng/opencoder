// E09 — 全文搜索 → 跳转命中行
// (testing.md §3 L4: the full-text search panel fetches /find hits and
// clicking a hit opens the file at the matching line.)

import { addServer, enterWorkspace, expect, gotoHome, test } from "./fixtures";

test("E09 full-text search jumps to the matching line", async ({ page }) => {
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // Files tab → search panel.
  await page.getByTestId("main-tab-files").click();
  await expect(page.getByTestId("files-viewer-pane")).toHaveAttribute("data-visible", "true");
  await page.getByTestId("files-search-toggle").click();
  await expect(page.getByTestId("files-search-pane")).toHaveAttribute("data-visible", "true");

  // The mock /find fixture matches "createSignal" in FileTree.tsx line 12.
  await page.getByTestId("search-input").fill("createSignal");
  await expect(page.getByTestId("search-hit-src/features/files/FileTree.tsx-12")).toBeVisible({
    timeout: 10_000,
  });

  // Clicking the hit opens the file (viewer tab) and flips back to the
  // viewer pane with the active line set.
  await page.getByTestId("search-hit-src/features/files/FileTree.tsx-12").click();
  await expect(page.getByTestId("files-viewer-pane")).toHaveAttribute("data-visible", "true");
  await expect(page.getByTestId("viewer-tab-src/features/files/FileTree.tsx")).toBeVisible();
  await expect(page.getByTestId("viewer-code")).not.toBeEmpty({ timeout: 15_000 });
});
