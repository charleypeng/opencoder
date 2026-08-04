// L1 tests for the desktop tray & global summon facade (TASK-M8-05): the
// outside-Tauri no-op guard (web/mobile builds never touch the IPC layer),
// the invoke arg assembly for the Rust commands (set_close_to_tray /
// get_close_to_tray / set_global_shortcut / get_global_shortcut /
// tray_set_badge) and the event subscriptions (tray-new-session,
// global-summon) with their unlisten lifecycle.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SUMMON_SHORTCUT,
  getCloseToTray,
  getGlobalShortcut,
  setCloseToTray,
  setGlobalShortcut,
  setTrayBadge,
  subscribeToGlobalSummon,
  subscribeToTrayNewSession,
} from "./tray.js";

const { invokeMock, listenMock } = vi.hoisted(() => {
  const listenMock = vi.fn<
    (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>
  >(() => Promise.resolve(() => {}));
  return { invokeMock: vi.fn(), listenMock };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

function withTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

function withoutTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, configurable: true });
}

afterEach(() => {
  vi.clearAllMocks();
  withoutTauri();
});

describe("close-to-tray", () => {
  it("setCloseToTray invokes set_close_to_tray with the flag", async () => {
    withTauri();
    invokeMock.mockResolvedValue(undefined);
    await setCloseToTray(true);
    expect(invokeMock).toHaveBeenCalledWith("set_close_to_tray", { enabled: true });
  });

  it("setCloseToTray is a no-op outside Tauri", async () => {
    await setCloseToTray(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("getCloseToTray resolves the Rust flag", async () => {
    withTauri();
    invokeMock.mockResolvedValue(true);
    await expect(getCloseToTray()).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("get_close_to_tray");
  });

  it("getCloseToTray resolves false outside Tauri without invoking", async () => {
    await expect(getCloseToTray()).resolves.toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("global summon shortcut", () => {
  it("setGlobalShortcut invokes set_global_shortcut with the accelerator", async () => {
    withTauri();
    invokeMock.mockResolvedValue("Ctrl+Shift+O");
    await expect(setGlobalShortcut("Ctrl+Shift+O")).resolves.toBe("Ctrl+Shift+O");
    expect(invokeMock).toHaveBeenCalledWith("set_global_shortcut", {
      accelerator: "Ctrl+Shift+O",
    });
  });

  it("setGlobalShortcut resolves the input outside Tauri without invoking", async () => {
    await expect(setGlobalShortcut("Ctrl+Shift+O")).resolves.toBe("Ctrl+Shift+O");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("getGlobalShortcut resolves the Rust value", async () => {
    withTauri();
    invokeMock.mockResolvedValue("Alt+Space");
    await expect(getGlobalShortcut()).resolves.toBe("Alt+Space");
    expect(invokeMock).toHaveBeenCalledWith("get_global_shortcut");
  });

  it("getGlobalShortcut resolves the default outside Tauri without invoking", async () => {
    await expect(getGlobalShortcut()).resolves.toBe(DEFAULT_SUMMON_SHORTCUT);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("tray badge", () => {
  it("setTrayBadge invokes tray_set_badge with the count", async () => {
    withTauri();
    invokeMock.mockResolvedValue(undefined);
    await setTrayBadge(3);
    expect(invokeMock).toHaveBeenCalledWith("tray_set_badge", { count: 3 });
  });

  it("setTrayBadge ignores non-positive counts", async () => {
    withTauri();
    await setTrayBadge(0);
    await setTrayBadge(-2);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("setTrayBadge is a no-op outside Tauri", async () => {
    await setTrayBadge(3);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("event subscriptions", () => {
  it("subscribeToTrayNewSession listens for tray-new-session", () => {
    withTauri();
    const onNewSession = vi.fn();
    const stop = subscribeToTrayNewSession(onNewSession);
    const call = listenMock.mock.calls.find(([name]) => name === "tray-new-session");
    expect(call).toBeDefined();
    call?.[1]({ payload: null });
    expect(onNewSession).toHaveBeenCalledTimes(1);
    void stop();
  });

  it("subscribeToGlobalSummon listens for global-summon", () => {
    withTauri();
    const onSummon = vi.fn();
    const stop = subscribeToGlobalSummon(onSummon);
    const call = listenMock.mock.calls.find(([name]) => name === "global-summon");
    expect(call).toBeDefined();
    call?.[1]({ payload: null });
    expect(onSummon).toHaveBeenCalledTimes(1);
    void stop();
  });

  it("subscriptions are no-ops outside Tauri", () => {
    const stopTray = subscribeToTrayNewSession(vi.fn());
    const stopSummon = subscribeToGlobalSummon(vi.fn());
    expect(listenMock).not.toHaveBeenCalled();
    stopTray();
    stopSummon();
  });
});
