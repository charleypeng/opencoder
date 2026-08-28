// E11 — Terminal create → type command → echo
// (testing.md §3 L4: the "+" button spawns the server's default shell
// instantly and the shell-picker chevron creates a specific shell, the
// tab mounts an xterm instance, and typing a command round-trips through
// the PTY channel with the echo rendered back.)
//
// Mock semantics: the express mock cannot upgrade to WebSocket, so the
// shim provides a client-side PTY channel (welcome banner + keystroke
// echo). The UI round trip is identical to production: create → connect →
// pty_ws_send → frames → xterm. Text is asserted on the channel telemetry
// (the shim records sends/frames) since xterm renders to a canvas.

import {
  addServer,
  enterWorkspace,
  expect,
  expectShimAtLeast,
  gotoHome,
  shimValue,
  test,
  waitForMockRequest,
} from "./fixtures";

test("E11 terminal create, type a command, echo round trip", async ({ page }) => {
  await gotoHome(page);
  await addServer(page);
  await enterWorkspace(page);

  // Open the terminal view. "+" spawns the server's default shell
  // instantly (docs/ui-audit-2026-08 §3 — no picker detour).
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-panel")).toBeVisible();
  const createPromise = waitForMockRequest(page, "POST", "/pty");
  await page.getByTestId("terminal-new").click();
  const created = await createPromise;
  expect((created.body as { command?: string }).command ?? undefined).toBeUndefined();
  await expect(page.getByTestId("terminal-tab-pty_created_1")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("terminal-instance-pty_created_1")).toBeVisible();

  // The chevron still opens the shell picker for a specific shell.
  await page.getByTestId("terminal-new-picker").click();
  await expect(page.getByTestId("terminal-shell-picker")).toBeVisible();
  const createBashPromise = waitForMockRequest(page, "POST", "/pty");
  await page.getByTestId("terminal-shell-bash").click();
  const createdBash = await createBashPromise;
  expect((createdBash.body as { command?: string }).command).toBe("/bin/bash");
  await expect(page.getByTestId("terminal-tab-pty_created_2")).toBeVisible({ timeout: 10_000 });

  // The freshly created bash tab is active and connects (welcome frame).
  await expect(page.getByTestId("terminal-instance-pty_created_2")).toBeVisible();
  await expectShimAtLeast(page, ["ptyFrames"], 1);

  // Focus the ACTIVE (bash) terminal, type a command and send it.
  await page
    .getByTestId("terminal-instance-pty_created_2")
    .getByTestId("terminal-container")
    .click();
  await page.keyboard.type("ls");
  await page.keyboard.press("Enter");
  await expectShimAtLeast(page, ["ptySends"], 1);

  // The echo frame comes back through the channel.
  await expect
    .poll(async () => (await shimValue(page, ["ptyFrames"])) as number, {
      timeout: 10_000,
      message: "echo frame arrives",
    })
    .toBeGreaterThanOrEqual(2);
});
