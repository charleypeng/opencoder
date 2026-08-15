// E13 — Desktop prefs survive a restart (Bug 1 regression): a custom
// global summon accelerator set in Settings → Desktop is persisted to
// localStorage (`oc-desktop`) and re-applied to the Rust side through
// applyDesktopPrefs when the shell mounts again. The test sets the
// accelerator, simulates a restart (page reload + re-entering the
// workspace), then asserts the replay actually pushed the persisted value
// (the tauri-shim records set_global_shortcut into sessionStorage across
// reloads) and that the settings UI shows the re-applied value.
//
// Bug 2 (tray lifecycle) is a Rust-side behaviour (tray exists only while
// close-to-tray is on; closing the window quits when it is off) and is not
// exercised here — see the src-tauri desktop.rs change.

import { addServer, enterWorkspace, expect, gotoHome, test } from "./fixtures";

test("E13 desktop prefs: custom summon accelerator survives a restart", async ({ page }) => {
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // Open Settings → Desktop and set a custom summon accelerator.
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-section-desktop").click();
  const input = page.getByTestId("desktop-shortcut-input");
  await expect(input).toBeVisible();
  await input.fill("Ctrl+Shift+O");
  await page.getByTestId("desktop-shortcut-save").click();

  // The applied (Rust-validated) value is persisted to oc-desktop.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("oc-desktop") ?? "{}"));
  expect(saved.globalShortcut).toBe("Ctrl+Shift+O");

  // Simulate a restart: clear the replay log, reload, re-add the server
  // (the shim registry is in-memory and resets on reload) and re-enter.
  await page.evaluate(() => sessionStorage.removeItem("__desktop_invoke_log__"));
  await page.reload();
  await expect(page.getByTestId("server-home")).toBeVisible();
  await addServer(page);
  await enterWorkspace(page);

  // The prefs replay on shell mount must have pushed the persisted
  // accelerator back to the Rust side.
  const log = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("__desktop_invoke_log__") ?? "[]"),
  );
  expect(log).toContain('set_global_shortcut:{"accelerator":"Ctrl+Shift+O"}');

  // The settings UI reflects the re-applied value.
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-section-desktop").click();
  await expect(page.getByTestId("desktop-shortcut-input")).toHaveValue("Ctrl+Shift+O");
});
