import { addServer, enterWorkspace, expect, gotoHome, openSession, test } from "./fixtures";

test.use({ viewport: { width: 1680, height: 1024 }, colorScheme: "dark" });

async function openFile(page: import("@playwright/test").Page, path: string): Promise<void> {
  await page.keyboard.press("Control+P");
  await page.getByTestId("quick-open-input").fill(path);
  await page.getByTestId(`quick-open-item-${path}`).click();
  await expect(page.locator('[data-testid="viewer-scroll"]:visible')).toBeVisible();
}

test("E15 gray workbench retains file tabs, chat and panel state", async ({ page }, info) => {
  await gotoHome(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "gray");
  await addServer(page);
  await enterWorkspace(page);
  await openSession(page, "sess_01");
  const chat = await page.getByTestId("message-list-scroll").elementHandle();
  await openFile(page, "src/features/sessions/PromptBox.tsx");
  const firstScroll = page.locator('[data-testid="viewer-scroll"]:visible');
  await expect(firstScroll.getByTestId("viewer-code")).toContainText("createSignal");
  await firstScroll.evaluate((element) => {
    element.scrollTop = 100;
  });
  const position = await firstScroll.evaluate((element) => element.scrollTop);
  const firstCode = await firstScroll.getByTestId("viewer-code").elementHandle();
  await openFile(page, "README.md");
  await expect(page.locator('[data-testid="viewer-markdown"]:visible')).toBeVisible();
  const tools = page.getByTestId("right-tool-panel");
  await expect(tools.getByRole("tab", { name: "PromptBox.tsx", exact: true })).toBeVisible();
  await tools.getByRole("tab", { name: "PromptBox.tsx", exact: true }).click();
  await expect(tools.getByRole("tab", { name: "PromptBox.tsx", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(firstScroll.getByTestId("viewer-code")).toContainText("createSignal");
  expect(await firstCode?.evaluate((element) => element.isConnected)).toBe(true);
  expect(await firstScroll.evaluate((element) => element.scrollTop)).toBe(position);
  expect(await chat?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(page.getByTestId("prompt-input")).toBeVisible();

  const main = page.locator("main");
  const mainBounds = await main.boundingBox();
  const toolBounds = await tools.boundingBox();
  expect(mainBounds!.width).toBeGreaterThanOrEqual(360);
  expect(toolBounds!.width).toBeGreaterThan(300);
  expect(toolBounds!.x).toBeGreaterThanOrEqual(mainBounds!.x + mainBounds!.width - 1);
  await page.screenshot({ path: info.outputPath("gray-workbench.png") });

  await page.getByTestId("titlebar-right-tools-toggle").click();
  await expect(tools).toBeHidden();
  expect(await firstCode?.evaluate((element) => element.isConnected)).toBe(true);
  await page.getByTestId("titlebar-right-tools-toggle").click();
  await expect(tools).toBeVisible();
  expect(await firstScroll.evaluate((element) => element.scrollTop)).toBe(position);

  await tools.getByRole("button", { name: "Close tab: PromptBox.tsx", exact: true }).click();
  await expect(tools.getByRole("tab", { name: "PromptBox.tsx", exact: true })).toHaveCount(0);
  expect(await firstCode?.evaluate((element) => element.isConnected)).toBe(false);
  await tools.getByRole("tab", { name: "README.md", exact: true }).click();
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(async () => (await main.boundingBox())!.width).toBeGreaterThanOrEqual(359);
  await expect(page.getByTestId("prompt-input")).toBeVisible();
});

test("E15 independent browser tabs retain frames and support reduced motion", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("oc-theme", "dark"));
  await page.route("https://preview.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<button onclick=\"this.textContent='Count: 1'\">Count: 0</button>",
    }),
  );
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);
  const tools = page.getByTestId("right-tool-panel");
  const browserTabs = tools.locator('[role="tab"][data-workbench-kind="browser"]');
  async function addBrowser() {
    await tools.getByTestId("right-tools-add-tab").click();
    await tools.getByTestId("right-tools-add-browser").click();
  }
  await addBrowser();
  const pane = page.locator('[data-testid="right-tools-browser-pane"]:visible');
  await pane.getByTestId("right-tools-browser-url").fill("https://preview.test/one");
  await pane.getByTestId("right-tools-browser-go").click();
  const frame = pane.frameLocator('[data-testid="right-tools-browser-frame"]');
  await frame.getByRole("button").click();
  await expect(frame.getByRole("button")).toHaveText("Count: 1");
  const frameNode = await pane.getByTestId("right-tools-browser-frame").elementHandle();
  await addBrowser();
  await expect(pane.getByTestId("right-tools-browser-url")).toHaveValue("");
  await pane.getByTestId("right-tools-browser-url").fill("https://preview.test/two");
  await pane.getByTestId("right-tools-browser-go").click();
  await browserTabs.first().click();
  await expect(pane.getByTestId("right-tools-browser-url")).toHaveValue("https://preview.test/one");
  expect(await frameNode?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(frame.getByRole("button")).toHaveText("Count: 1");
  await page.getByTestId("titlebar-right-tools-toggle").click();
  await page.getByTestId("titlebar-right-tools-toggle").click();
  await expect(frame.getByRole("button")).toHaveText("Count: 1");
  const motion = await tools
    .locator('[role="tabpanel"]:visible')
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(motion).toBe("none");
  await page.screenshot({ path: info.outputPath("dark-workbench.png") });

  const browserTab = browserTabs.first();
  await browserTab.focus();
  await page.keyboard.press("Delete");
  await expect(browserTabs).toHaveCount(1);
  expect(await frameNode?.evaluate((element) => element.isConnected)).toBe(false);
  await browserTabs.click();
  await expect(pane.getByTestId("right-tools-browser-url")).toHaveValue("https://preview.test/two");
});
