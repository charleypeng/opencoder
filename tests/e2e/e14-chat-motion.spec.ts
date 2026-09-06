import { test, expect } from "@playwright/test";

test("chat motion: live light, nested disclosure, long text and reduced motion", async ({
  page,
}, testInfo) => {
  await page.route("**/motion-preview", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html data-theme="light"><body style="background:var(--bg-base);color:var(--fg-primary)"><div id="root"></div><script type="module" src="/tests/e2e/chat-motion.fixture.tsx"></script></body></html>',
    }),
  );
  await page.goto("/motion-preview");
  const user = page.getByTestId("user-message-content");
  await expect(user).toHaveAttribute("data-collapsed", "true");
  await expect(user).toContainText("END OF ORIGINAL MESSAGE");
  const before = (await user.boundingBox())!.height;
  await page.getByTestId("user-message-toggle").click();
  await expect.poll(async () => (await user.boundingBox())!.height).toBeGreaterThan(before * 2);
  await page.getByTestId("user-message-toggle").click();
  await expect.poll(async () => (await user.boundingBox())!.height).toBeLessThan(before + 1);

  const status = page.getByTestId("process-fold-status");
  await expect(status).toHaveCSS("animation-name", "chat-status-light");
  await page.getByTestId("activity-entry-toggle").click();
  await expect(page.getByTestId("reasoning-body")).toBeVisible();
  await page.getByTestId("tool-toggle").click();
  await expect(page.getByTestId("tool-detail")).toBeVisible();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.screenshot({
    path: testInfo.outputPath("chat-motion-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({
    path: testInfo.outputPath("chat-motion-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByTestId("tool-toggle").click();
  await expect(page.getByTestId("tool-detail")).toHaveCount(0);
  await page.getByTestId("tool-toggle").click();
  await expect(page.getByTestId("tool-detail")).toBeVisible();
  await page.getByTestId("process-fold-toggle").click();
  await expect(page.getByTestId("process-fold-body")).toBeHidden();
  await page.getByTestId("process-fold-toggle").click();
  await expect(page.getByTestId("tool-detail")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(status).toHaveCSS("animation-name", "none");
  await page.getByTestId("finish-run").click();
  await expect(status).not.toHaveClass(/chat-status-shimmer/);
});
