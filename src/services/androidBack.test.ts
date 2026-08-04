// L1 tests for the Android system back handler (TASK-M7-10): the pure
// resolveBack decision table (dismissible sheet first / pop / pinned-sheet
// and root both unhandled), the facade's reactive listener registration —
// the native `onBackButtonPress` listener exists ONLY while a back press
// can be handled, so Android's native default (background the app)
// resumes at the root — and the event dispatch through the two handlers.
// The `@tauri-apps/api/app` module is mocked; the facade's own
// Tauri+Android guard is covered by the no-op cases.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { startAndroidBack, resolveBack, isAndroidBackActive } from "./androidBack";
import { refreshPlatform } from "../platform/index.js";

const { onBackButtonPressMock } = vi.hoisted(() => ({
  onBackButtonPressMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({ onBackButtonPress: onBackButtonPressMock }));

function pluginListener() {
  return { unregister: vi.fn().mockResolvedValue(undefined) };
}

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const ORIGINAL_UA = window.navigator.userAgent;

function withTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

function withoutTauri(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, configurable: true });
}

function withAndroidPlatform(): void {
  Object.defineProperty(window.navigator, "userAgent", { value: ANDROID_UA, configurable: true });
  refreshPlatform();
}

function withDesktopPlatform(): void {
  Object.defineProperty(window.navigator, "userAgent", { value: MAC_UA, configurable: true });
  refreshPlatform();
}

afterEach(() => {
  vi.clearAllMocks();
  withoutTauri();
  Object.defineProperty(window.navigator, "userAgent", {
    value: ORIGINAL_UA,
    configurable: true,
  });
  refreshPlatform();
});

describe("resolveBack", () => {
  const base = { sheet: null, stackDepth: 1 };

  it("closes a dismissible sheet with priority", () => {
    expect(resolveBack({ sheet: { dismissible: true }, stackDepth: 5 })).toBe("closeSheet");
    expect(resolveBack({ sheet: { dismissible: true }, stackDepth: 1 })).toBe("closeSheet");
  });

  it("never closes a pinned sheet, even with a deep stack", () => {
    expect(resolveBack({ sheet: { dismissible: false }, stackDepth: 5 })).toBe("none");
    expect(resolveBack({ sheet: { dismissible: false }, stackDepth: 1 })).toBe("none");
  });

  it("pops when the active tab's stack is deeper than its root", () => {
    expect(resolveBack({ ...base, stackDepth: 2 })).toBe("pop");
  });

  it("leaves the root page unhandled (native default resumes)", () => {
    expect(resolveBack(base)).toBe("none");
  });
});

describe("isAndroidBackActive", () => {
  it("is inactive outside Tauri", () => {
    withoutTauri();
    withAndroidPlatform();
    expect(isAndroidBackActive()).toBe(false);
  });

  it("is inactive on the desktop platform", () => {
    withTauri();
    withDesktopPlatform();
    expect(isAndroidBackActive()).toBe(false);
  });

  it("is active on Tauri Android", () => {
    withTauri();
    withAndroidPlatform();
    expect(isAndroidBackActive()).toBe(true);
  });
});

describe("startAndroidBack", () => {
  function context(depth = 1, sheet: { dismissible: boolean } | null = null) {
    return { stackDepth: depth, sheet };
  }

  it("registers the back listener only while a back press is handled", async () => {
    withTauri();
    withAndroidPlatform();
    const listener = pluginListener();
    onBackButtonPressMock.mockResolvedValue(listener);
    // A signal mirrors the reactive store context the shell provides.
    const [depth, setDepth] = createSignal(1);
    const controller = startAndroidBack({
      getContext: () => context(depth()),
      handlers: { closeSheet: vi.fn(), pop: vi.fn() },
    });

    // Root: nothing to handle, no listener.
    expect(onBackButtonPressMock).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(onBackButtonPressMock).not.toHaveBeenCalled();

    // A push makes the back press handleable: the listener registers.
    setDepth(2);
    await vi.waitFor(() =>
      expect(onBackButtonPressMock).toHaveBeenCalledWith(expect.any(Function)),
    );
    await vi.waitFor(() => expect(controller.listening()).toBe(true));

    // Back at the root again: the listener unregisters so the native
    // default (background the app) resumes.
    setDepth(1);
    await vi.waitFor(() => expect(controller.listening()).toBe(false));
    expect(listener.unregister).toHaveBeenCalled();

    controller.dispose();
  });

  it("dispatches a back press to the pop handler", async () => {
    withTauri();
    withAndroidPlatform();
    const pop = vi.fn();
    onBackButtonPressMock.mockResolvedValue(pluginListener());
    startAndroidBack({
      getContext: () => context(2),
      handlers: { closeSheet: vi.fn(), pop },
    });
    await vi.waitFor(() => expect(onBackButtonPressMock).toHaveBeenCalled());

    const [onBack] = onBackButtonPressMock.mock.calls[0] as [
      (payload: { canGoBack: boolean }) => void,
    ];
    onBack({ canGoBack: false });
    expect(pop).toHaveBeenCalledTimes(1);
  });

  it("dispatches a back press to the sheet close handler first", async () => {
    withTauri();
    withAndroidPlatform();
    const closeSheet = vi.fn();
    onBackButtonPressMock.mockResolvedValue(pluginListener());
    startAndroidBack({
      getContext: () => context(5, { dismissible: true }),
      handlers: { closeSheet, pop: vi.fn() },
    });
    await vi.waitFor(() => expect(onBackButtonPressMock).toHaveBeenCalled());

    const [onBack] = onBackButtonPressMock.mock.calls[0] as [
      (payload: { canGoBack: boolean }) => void,
    ];
    onBack({ canGoBack: false });
    expect(closeSheet).toHaveBeenCalledTimes(1);
  });

  it("ignores the back press while a pinned sheet blocks it", async () => {
    withTauri();
    withAndroidPlatform();
    const closeSheet = vi.fn();
    const pop = vi.fn();
    startAndroidBack({
      getContext: () => context(5, { dismissible: false }),
      handlers: { closeSheet, pop },
    });
    await Promise.resolve();
    // No listener at all: the native default handles the press.
    expect(onBackButtonPressMock).not.toHaveBeenCalled();
    expect(closeSheet).not.toHaveBeenCalled();
    expect(pop).not.toHaveBeenCalled();
  });

  it("never registers outside Tauri or off Android", async () => {
    onBackButtonPressMock.mockResolvedValue(pluginListener());
    const make = () =>
      startAndroidBack({
        getContext: () => context(2),
        handlers: { closeSheet: vi.fn(), pop: vi.fn() },
      });

    withDesktopPlatform();
    withTauri();
    make();
    withoutTauri();
    withAndroidPlatform();
    make();
    await Promise.resolve();
    expect(onBackButtonPressMock).not.toHaveBeenCalled();
  });

  it("disposes the listener and stops reacting", async () => {
    withTauri();
    withAndroidPlatform();
    const listener = pluginListener();
    onBackButtonPressMock.mockResolvedValue(listener);
    const [depth, setDepth] = createSignal(2);
    const controller = startAndroidBack({
      getContext: () => context(depth()),
      handlers: { closeSheet: vi.fn(), pop: vi.fn() },
    });
    await vi.waitFor(() => expect(controller.listening()).toBe(true));

    controller.dispose();
    await Promise.resolve();
    expect(listener.unregister).toHaveBeenCalled();
    expect(controller.listening()).toBe(false);

    // A context change after dispose must not re-register.
    setDepth(3);
    await Promise.resolve();
    expect(onBackButtonPressMock).toHaveBeenCalledTimes(1);
  });
});
