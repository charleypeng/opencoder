// L1 tests for the notification facade (TASK-M8-06): the outside-Tauri
// no-op guard (web builds never touch the plugin), the first-use-only
// permission flow (desktop grants without a prompt, mobile requests on
// first send), the send arg assembly, the window-focus probe, the click
// subscription lifecycle (mobile-only channel) and the focus call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  isPermissionGrantedMock,
  requestPermissionMock,
  sendNotificationMock,
  onActionMock,
  isFocusedMock,
  setFocusMock,
} = vi.hoisted(() => ({
  isPermissionGrantedMock: vi.fn(),
  requestPermissionMock: vi.fn(),
  sendNotificationMock: vi.fn(),
  onActionMock: vi.fn(),
  isFocusedMock: vi.fn(),
  setFocusMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: isPermissionGrantedMock,
  requestPermission: requestPermissionMock,
  sendNotification: sendNotificationMock,
  onAction: onActionMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFocused: isFocusedMock, setFocus: setFocusMock }),
}));

// The facade caches its permission resolution per module instance (request
// on first use); a fresh module per test keeps the cache from leaking
// between tests.
type NotificationFacade = typeof import("./notifications.js");
let mod: NotificationFacade;

beforeEach(async () => {
  vi.resetModules();
  mod = await import("./notifications.js");
  isPermissionGrantedMock.mockReset();
  requestPermissionMock.mockReset();
  sendNotificationMock.mockReset();
  onActionMock.mockReset();
  isFocusedMock.mockReset();
  setFocusMock.mockReset();
});

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

describe("notify", () => {
  it("sends a notification with title and body once permission is granted", async () => {
    withTauri();
    isPermissionGrantedMock.mockResolvedValue(true);
    await mod.notify({ title: "Generation complete", body: "Session A" });
    expect(sendNotificationMock).toHaveBeenCalledWith({
      title: "Generation complete",
      body: "Session A",
    });
    expect(requestPermissionMock).not.toHaveBeenCalled();
  });

  it("requests permission on first use and skips the send when denied", async () => {
    withTauri();
    isPermissionGrantedMock.mockResolvedValue(false);
    requestPermissionMock.mockResolvedValue("denied");
    await mod.notify({ title: "Permission requested" });
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("requests permission on first use and sends once granted", async () => {
    withTauri();
    isPermissionGrantedMock.mockResolvedValue(false);
    requestPermissionMock.mockResolvedValue("granted");
    await mod.notify({ title: "Question asked", body: "Pick an option" });
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalledWith({
      title: "Question asked",
      body: "Pick an option",
    });
  });

  it("requests permission only once across sends", async () => {
    withTauri();
    isPermissionGrantedMock.mockResolvedValue(false);
    requestPermissionMock.mockResolvedValue("granted");
    await mod.notify({ title: "A" });
    await mod.notify({ title: "B" });
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
  });

  it("is a no-op outside Tauri", async () => {
    await mod.notify({ title: "Generation complete" });
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(requestPermissionMock).not.toHaveBeenCalled();
  });
});

describe("window focus", () => {
  it("isWindowFocused resolves the window's isFocused", async () => {
    withTauri();
    isFocusedMock.mockResolvedValue(false);
    await expect(mod.isWindowFocused()).resolves.toBe(false);
    await expect(mod.isWindowFocused()).resolves.toBe(false);
  });

  it("isWindowFocused resolves true outside Tauri", async () => {
    await expect(mod.isWindowFocused()).resolves.toBe(true);
    expect(isFocusedMock).not.toHaveBeenCalled();
  });

  it("focusWindow calls setFocus on the current window", async () => {
    withTauri();
    setFocusMock.mockResolvedValue(undefined);
    await mod.focusWindow();
    expect(setFocusMock).toHaveBeenCalledTimes(1);
  });

  it("focusWindow is a no-op outside Tauri", async () => {
    await mod.focusWindow();
    expect(setFocusMock).not.toHaveBeenCalled();
  });
});

describe("click subscription", () => {
  it("subscribes to onAction and unregisters", async () => {
    withTauri();
    const unregister = vi.fn(async () => {});
    onActionMock.mockResolvedValue({ unregister });
    const onClick = vi.fn();
    const stop = mod.subscribeToNotificationClick(onClick);
    const call = onActionMock.mock.calls[0];
    expect(call).toBeDefined();
    call?.[0]();
    expect(onClick).toHaveBeenCalledTimes(1);
    await stop();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("is a no-op outside Tauri", () => {
    const stop = mod.subscribeToNotificationClick(vi.fn());
    expect(onActionMock).not.toHaveBeenCalled();
    stop();
  });
});
