// E09 — Full-text search → jump to the matching line
// (testing.md §3 L4: the full-text search panel fetches /find hits and
// clicking a hit opens the file at the matching line.)

import { addServer, enterWorkspace, expect, gotoHome, test } from "./fixtures";

test("E09 full-text search jumps to the matching line", async ({ page }) => {
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // Open the full-text search from its global shortcut.
  await page.keyboard.press("Control+Shift+F");
  await expect(page.getByTestId("files-search-pane")).toHaveAttribute("data-visible", "true");

  // The mock /find fixture matches "createSignal" in FileTree.tsx line 12.
  await page.getByTestId("search-input").fill("createSignal");
  await expect(page.getByTestId("search-hit-src/features/files/FileTree.tsx-12")).toBeVisible({
    timeout: 10_000,
  });

  // Clicking the hit opens the file in the right-side workbench and returns
  // to its viewer pane with the active line set.
  const filesPane = page.locator('[data-testid="right-tools-files-pane"]:visible');
  await page.getByTestId("search-hit-src/features/files/FileTree.tsx-12").click();
  await expect(page.getByTestId("right-tool-panel")).toBeVisible();
  await expect(filesPane.getByTestId("file-viewer")).toBeVisible();
  await expect(filesPane.getByTestId("viewer-code")).not.toBeEmpty({ timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "FileTree.tsx", exact: true })).toBeVisible();
});
