// UI screenshot script: drives the real app (mock server + vite dev +
// tauri shim) and captures the main screens. Usage:
//   node scripts/screenshot-ui.mjs [outdir] [scale]
// With a scale (e.g. 1.4) the persisted oc-ui-scale is set before load.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? ".ui-shots";
const SCALE = process.argv[3];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript({
  path: fileURLToPath(new URL("./tauri-shim.js", import.meta.url)),
});

const MOCK_URL = "http://localhost:14096";

if (SCALE) {
  await page.addInitScript((scale) => localStorage.setItem("oc-ui-scale", String(scale)), SCALE);
}

await page.goto("http://localhost:1420/");
await page.getByTestId("server-home").waitFor();
await page.screenshot({ path: `${OUT}/01-server-home.png` });

// Add the mock server through the real wizard.
await page.getByTestId("empty-state").waitFor();
await page.getByTestId("add-first-server").click();
await page.getByTestId("add-server").waitFor();
await page.getByTestId("name-input").fill("Mock Server");
await page.getByTestId("url-input").fill(MOCK_URL);
await page.getByTestId("test-connection").click();
await page.getByTestId("probe-success").waitFor();
await page.screenshot({ path: `${OUT}/02-add-server-probe.png` });
await page.getByTestId("save-server").click();
await page.getByTestId("server-grid").waitFor();
await page.screenshot({ path: `${OUT}/03-server-grid.png` });

// Enter the workspace (chat shell).
await page.locator('[data-testid^="server-card-"]').first().click();
await page.getByTestId("desktop-shell").waitFor();
await page.getByTestId("session-list").waitFor();
await page.screenshot({ path: `${OUT}/04-workspace.png` });

// Open settings and the appearance section.
await page.getByTestId("rail-settings").click();
await page.getByTestId("settings-page").waitFor();
await page.getByTestId("settings-section-appearance").click();
await page.getByTestId("appearance-section").waitFor();
await page.screenshot({ path: `${OUT}/05-settings-appearance.png` });

// Current effective root font sizes + the RENDERED size of a settings
// nav button — with the font-size mechanism the computed styles ARE the
// rendered sizes (no zoom factor, so rect and computed style agree).
const metrics = await page.evaluate(() => {
  const html = document.documentElement;
  const scaleVar = html.style.getPropertyValue("--ui-scale") || "1";
  const btn = document.querySelector('[data-testid^="settings-section-"]');
  const btnSize = btn ? getComputedStyle(btn) : null;
  const btnRect = btn?.getBoundingClientRect();
  return {
    scaleVar,
    htmlFontSize: getComputedStyle(html).fontSize,
    navButtonFont: btnSize?.fontSize ?? null,
    navButtonHeightRendered: btnRect ? `${Math.round(btnRect.height)}px` : null,
    bodyFont: getComputedStyle(document.body).fontSize,
  };
});
console.log("METRICS:", JSON.stringify(metrics, null, 2));

// Live-apply check: drag the UI scale slider and confirm the root
// font-size changes without a reload.
await page.getByTestId("ui-scale-slider").fill("1.4");
await page.waitForTimeout(200);
const after = await page.evaluate(() => ({
  htmlFontSize: getComputedStyle(document.documentElement).fontSize,
  stored: localStorage.getItem("oc-ui-scale"),
  label: document.querySelector('[data-testid="ui-scale-value"]')?.textContent,
}));
console.log("LIVE-APPLY:", JSON.stringify(after));
await page.screenshot({ path: `${OUT}/06-settings-appearance-140.png` });

await browser.close();
console.log(`screenshots written to ${OUT}/`);
