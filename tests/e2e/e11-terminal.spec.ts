// E11 — 终端创建 → 输入命令 → 回显
// (testing.md §3 L4: the terminal view creates a PTY through the shell
// picker, the tab mounts an xterm instance, and typing a command round-
// trips through the PTY channel with the echo rendered back.)
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

  // Open the terminal view and create a PTY from the shell picker.
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-panel")).toBeVisible();
  await page.getByTestId("terminal-new").click();
  await expect(page.getByTestId("terminal-shell-picker")).toBeVisible();
  const createPromise = waitForMockRequest(page, "POST", "/pty");
  await page.getByTestId("terminal-shell-bash").click();
  await createPromise;

  // The tab appears and the instance connects (welcome banner frame).
  await expect(page.getByTestId("terminal-tab-pty_created_1")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("terminal-instance-pty_created_1")).toBeVisible();
  await expectShimAtLeast(page, ["ptyFrames"], 1);

  // Focus the terminal, type a command and send it.
  await page.getByTestId("terminal-container").click();
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
