// E14 — PROCESS-REF-04 replay acceptance: verifies the reference process
// presentation end to end with deterministic mock scenarios — the elapsed
// header, the flat reading flow, the compact tool row, and the animated tail
// status — plus the honest-state variants (permission wait, history load).
//
// The animation itself is never asserted with pixel comparison: a 100 ms
// in-page sampler records computed background-position values of the same
// mounted text node (time-advance proof), while still screenshots freeze a
// phase for visual review. The happy-chat timeline (waiting → text → tool →
// text → idle) stands in for the plan's ideal 2s/4s/3s replay; the mock
// server is frozen, so a dedicated timeline is recorded as a scope gap.

import {
  addServer,
  enterWorkspace,
  expect,
  gotoHome,
  holdEventStream,
  test,
  useScenario,
} from "./fixtures";

test.use({ video: { mode: "on", dir: "/tmp/e14-video" } });

test.describe("reference process replay", () => {
  test.describe("recorded journey", () => {
    test("E14.1 light journey with recording, sweep time-advance, and phase shots", async ({
      page,
    }) => {
      // The full journey (scenario replay + 20s sampler + 8s calm tail)
      // intentionally outlasts the default 60s budget.
      test.setTimeout(150_000);
      const held = await holdEventStream(page);
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
      await gotoHome(page);
      await addServer(page);
      await enterWorkspace(page);

      await page.getByTestId("workspace-new-session").click();
      await page.getByTestId("prompt-input").fill("Explain the codebase");
      await page.getByTestId("prompt-send").click();

      // Detached 100 ms sampler: proof the sweep moves without pixel diffs.
      await page.evaluate(() => {
        const win = window as typeof window & {
          __E14_POSITIONS__: string[];
          __E14_DONE__?: boolean;
        };
        win.__E14_POSITIONS__ = [];
        win.__E14_DONE__ = false;
        const started = Date.now();
        const tick = () => {
          const el = document.querySelector<HTMLElement>(
            '[data-testid="process-tail-status"][data-animated="true"] .reply-tail-status-text',
          );
          if (el !== null) win.__E14_POSITIONS__.push(getComputedStyle(el).backgroundPosition);
          if (Date.now() - started < 20_000) window.setTimeout(tick, 100);
          else win.__E14_DONE__ = true;
        };
        tick();
      });
      held.release();

      await expect(page.getByTestId("workspace-session-ses_abc123")).toBeVisible({
        timeout: 15_000,
      });
      await page.getByTestId("workspace-session-ses_abc123").click();
      await expect(page.getByTestId("message-list")).toContainText("Hello! I can help with that.", {
        timeout: 15_000,
      });

      // The happy-chat timeline is short; the tail status beside the elapsed
      // header carries the sweep even while the fold stays collapsed, so the
      // sampler does not depend on catching an expanded active window. Freeze
      // a phase shot only when a live fold is still on screen.
      const activeFold = page.locator('[data-testid="process-fold"][data-active="true"]');
      if ((await activeFold.count()) > 0) {
        const toggle = activeFold.getByTestId("process-fold-toggle");
        await expect(activeFold.getByTestId("process-fold-status")).toContainText("Processing");
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
        await page.screenshot({ path: "/tmp/e14-light-active.png" });
      }

      // Time-advance: the animated node's background-position moved between
      // samples taken from the same mounted element.
      await page.waitForFunction(
        () => (window as unknown as { __E14_DONE__?: boolean }).__E14_DONE__ === true,
        { timeout: 40_000 },
      );
      const positions = await page.evaluate(
        () => (window as unknown as { __E14_POSITIONS__: string[] }).__E14_POSITIONS__,
      );
      expect(positions.length).toBeGreaterThan(2);
      expect(new Set(positions).size).toBeGreaterThan(1);

      // Completion: tail status gone, run idle, final answer outside the fold.
      await expect(page.locator('[data-testid="process-tail-status"]')).toHaveCount(0, {
        timeout: 20_000,
      });
      await expect(page.locator('[data-testid="process-fold"][data-active="true"]')).toHaveCount(0);
      await expect(
        page.getByTestId("message-list").getByText("Found 3 files. I will summarize them for you."),
      ).toBeVisible();

      // Hold the idle state so the recording covers a full calm tail.
      await page.waitForTimeout(8_000);
      await page.screenshot({ path: "/tmp/e14-light-done.png" });
      // Playwright finalizes the recording into the configured dir when the
      // context closes; saveAs here would wait on the still-open page.
    });
  });

  test("E14.2 dark theme active-run screenshot", async ({ page }) => {
    const held = await holdEventStream(page);
    // Dark: the app resolves "system" through prefers-color-scheme.
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await gotoHome(page);
    await addServer(page);
    await enterWorkspace(page);
    await page.getByTestId("workspace-new-session").click();
    held.release();
    await expect(page.getByTestId("workspace-session-ses_abc123")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("workspace-session-ses_abc123").click();
    const activeFold = page.locator('[data-testid="process-fold"][data-active="true"]');
    await expect(activeFold).toBeVisible({ timeout: 15_000 });
    const toggle = activeFold.getByTestId("process-fold-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(activeFold.locator('[data-testid="process-tail-status"]')).toBeVisible();
    await page.screenshot({ path: "/tmp/e14-dark-active.png" });
  });

  test("E14.3 reduced motion renders a solid readable status", async ({ page }) => {
    const held = await holdEventStream(page);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await gotoHome(page);
    await addServer(page);
    await enterWorkspace(page);
    await page.getByTestId("workspace-new-session").click();
    held.release();
    await expect(page.getByTestId("workspace-session-ses_abc123")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("workspace-session-ses_abc123").click();
    const activeFold = page.locator('[data-testid="process-fold"][data-active="true"]');
    await expect(activeFold).toBeVisible({ timeout: 15_000 });
    const toggle = activeFold.getByTestId("process-fold-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const text = activeFold.locator(
      '[data-testid="process-tail-status"][data-animated="true"] .reply-tail-status-text',
    );
    await expect(text).toBeVisible();
    // Degraded: no animation runs and the fill stays solid (no transparent
    // text), so the status remains readable without motion.
    await expect
      .poll(async () => text.evaluate((el) => getComputedStyle(el).animationName))
      .toBe("none");
    const fill = await text.evaluate((el) => getComputedStyle(el).webkitTextFillColor);
    expect(fill).not.toBe("transparent");
    await page.screenshot({ path: "/tmp/e14-reduced-motion.png" });
  });

  test("E14.4 permission wait shows a solid waiting-for-user status", async ({ page }) => {
    useScenario(page, "permission-flow");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    await gotoHome(page);
    await addServer(page);
    await enterWorkspace(page);

    // The scenario creates its own session and asks permission ~650ms after
    // the stream opens (mirrors E05's timing).
    await expect(page.getByTestId("workspace-session-ses_abc123")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("workspace-session-ses_abc123").click();
    await expect(page.getByTestId("message-list")).toBeVisible();

    // The permission sheet is the real handling entry point; behind it, the
    // run's status must say it is waiting on the user — with no sweep.
    await expect(page.getByTestId("permission-sheet")).toBeVisible({ timeout: 15_000 });
    const tail = page.locator(
      '[data-testid="process-tail-status"][data-kind="waiting-user"][data-animated="false"]',
    );
    await expect(tail).toBeVisible({ timeout: 15_000 });
    await expect(tail).toContainText("Waiting for your approval");
  });

  test("E14.5 history loads with collapsed folds and no tail status", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    await gotoHome(page);
    await addServer(page);
    await enterWorkspace(page);

    // The REST-synced fixture session is pure history: every fold starts
    // collapsed, inactive, and without an animated tail status.
    await expect(page.getByTestId("workspace-session-sess_01")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("workspace-session-sess_01").click();
    await expect(page.getByTestId("message-list")).toBeVisible({ timeout: 15_000 });
    const fold = page.locator('[data-testid="process-fold"]').first();
    await expect(fold).toBeVisible();
    await expect(fold).toHaveAttribute("data-active", "false");
    await expect(fold.getByTestId("process-fold-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('[data-testid="process-tail-status"]')).toHaveCount(0);
  });
});
