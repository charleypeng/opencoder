// E16 — mobile chat transcript containment (regression guard).
//
// The mobile shell must keep the chat inside its own scroll container:
// the transcript scrolls internally, the composer and bottom nav stay
// pinned to the viewport, and the shell never grows to the virtual-list
// total height (which lets focus/scrollIntoView shift the whole app).
//
// This journey runs in an iPhone viewport with touch enabled, so the
// mobile shell (src/platform) and its pull-to-refresh session loader are
// exercised through the real UI.

import { devices } from "@playwright/test";
import { addServer, expect, gotoHome, test } from "./fixtures";
import type { Page } from "@playwright/test";

const IPHONE = devices["iPhone 13"];

test.use({
  viewport: IPHONE.viewport,
  userAgent: IPHONE.userAgent,
  deviceScaleFactor: IPHONE.deviceScaleFactor,
  isMobile: IPHONE.isMobile,
  hasTouch: IPHONE.hasTouch,
});

/** Pulls the session list down with real touch events (the mobile shell's
 *  first-load path is its pull-to-refresh gesture). */
async function pullToRefresh(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const x = Math.round((IPHONE.viewport?.width ?? 390) / 2);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: 180 }],
  });
  for (let y = 200; y <= 340; y += 20) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y }],
    });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("E16 mobile chat scrolls inside the shell and keeps the composer pinned", async ({
  page,
}, info) => {
  await gotoHome(page);
  await addServer(page);
  await page.locator('[data-testid^="server-card-"]').first().click();
  await expect(page.getByTestId("mobile-shell")).toBeVisible();
  await expect(page.getByTestId("mobile-page-sessions-root")).toBeVisible();

  await pullToRefresh(page);
  const longSession = page.getByTestId("session-row-ses_long_mobile");
  await expect(longSession).toBeVisible({ timeout: 15_000 });
  await longSession.click();

  await expect(page.getByTestId("mobile-page-chat")).toBeVisible();
  await expect(page.getByTestId("message-list")).toBeVisible();
  // The fixture's last assistant message proves history loaded.
  await expect(page.getByText("第 40 条回答")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);

  const layout = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="mobile-shell"]') as HTMLElement;
    const scroll = document.querySelector('[data-testid="message-list-scroll"]') as HTMLElement;
    const nav = document.querySelector('[data-testid="mobile-nav"]') as HTMLElement;
    const composer = document.querySelector('[data-testid="mobile-chat-composer"]') as HTMLElement;
    const root = document.getElementById("root") as HTMLElement;
    const navRect = nav.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    return {
      viewport: window.innerHeight,
      shellOverflow: shell.scrollHeight - shell.clientHeight,
      rootScrollTop: root.scrollTop,
      scrollRange: scroll.scrollHeight - scroll.clientHeight,
      scrollTop: scroll.scrollTop,
      navBottom: navRect.bottom,
      composerBottom: composerRect.bottom,
    };
  });

  // The transcript owns its overflow; the shell must not grow with it.
  expect(layout.scrollRange).toBeGreaterThan(0);
  expect(layout.scrollTop).toBeGreaterThan(0);
  expect(layout.shellOverflow).toBeLessThanOrEqual(1);
  expect(layout.rootScrollTop).toBe(0);

  // Composer and nav stay pinned to the bottom edge in order.
  expect(Math.abs(layout.navBottom - layout.viewport)).toBeLessThanOrEqual(1);
  expect(layout.composerBottom).toBeLessThanOrEqual(layout.navBottom + 1);

  await page.screenshot({ path: info.outputPath("mobile-chat.png") });
});
