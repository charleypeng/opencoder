// L1 tests for the theme store (TASK-M9-03): mode resolution incl. the
// system preference through a matchMedia mock, accent application to the
// --accent CSS variable, the mobile-only OLED true-black value, the
// per-server override resolution (server ?? global) and the persistence of
// every field.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPlatform } from "../platform/index.js";
import {
  ACCENT_PRESETS,
  applyTheme,
  accentColor,
  clearServerThemeOverride,
  effectiveMode,
  resolveMode,
  serverThemeOverride,
  setAccent,
  setOled,
  setServerThemeOverride,
  setThemeMode,
  setThemeServer,
  themeMode,
  accent,
  oled,
} from "./theme.js";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/** Stubs window.matchMedia with a fixed dark-system answer. */
function mockMatchMedia(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: dark,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function themeAttr(): string | undefined {
  return document.documentElement.dataset.theme;
}

function accentVar(): string {
  return document.documentElement.style.getPropertyValue("--accent");
}

function toMobile() {
  Object.defineProperty(window.navigator, "userAgent", {
    value: IPHONE_UA,
    configurable: true,
  });
  refreshPlatform();
}

function toDesktop() {
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    configurable: true,
  });
  refreshPlatform();
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  toDesktop();
  // Reset the in-memory state through the public API (the storage has
  // just been cleared, so the persisted side matches the defaults).
  setThemeMode("system");
  setAccent(ACCENT_PRESETS[0].id);
  setOled(false);
  clearServerThemeOverride("srv-a");
  clearServerThemeOverride("srv-b");
  setThemeServer(undefined);
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--accent");
});

afterEach(() => {
  vi.unstubAllGlobals();
  toDesktop();
});

describe("resolveMode", () => {
  it("maps explicit modes directly", () => {
    expect(resolveMode("dark")).toBe("dark");
    expect(resolveMode("light")).toBe("light");
  });

  it("follows the system preference for the system mode", () => {
    mockMatchMedia(true);
    expect(resolveMode("system")).toBe("dark");
    mockMatchMedia(false);
    expect(resolveMode("system")).toBe("light");
  });

  it("falls back to light when matchMedia is unavailable", () => {
    expect(typeof window.matchMedia).not.toBe("function");
    expect(resolveMode("system")).toBe("light");
  });
});

describe("accentColor", () => {
  it("resolves preset ids to their hex", () => {
    expect(accentColor("indigo")).toBe("#7c8cff");
    expect(accentColor("emerald")).toBe("#34d399");
  });

  it("passes custom hex values through", () => {
    expect(accentColor("#123abc")).toBe("#123abc");
  });

  it("falls back to the default accent for unknown values", () => {
    expect(accentColor("nonsense")).toBe(ACCENT_PRESETS[0].color);
    expect(accentColor("rgb(1,2,3)")).toBe(ACCENT_PRESETS[0].color);
  });
});

describe("applyTheme", () => {
  it("writes the resolved theme to dataset.theme", () => {
    setThemeMode("dark");
    expect(themeAttr()).toBe("dark");
    setThemeMode("light");
    expect(themeAttr()).toBe("light");
  });

  it("resolves the system mode through matchMedia", () => {
    mockMatchMedia(true);
    applyTheme();
    expect(themeAttr()).toBe("dark");
    mockMatchMedia(false);
    applyTheme();
    expect(themeAttr()).toBe("light");
  });

  it("applies a preset accent to the --accent CSS variable", () => {
    setThemeMode("dark");
    setAccent("emerald");
    expect(accentVar()).toBe("#34d399");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("applies a custom hex accent to the --accent CSS variable", () => {
    setAccent("#123abc");
    expect(accentVar()).toBe("#123abc");
  });

  it("uses the default accent when nothing is stored", () => {
    applyTheme();
    expect(accentVar()).toBe(ACCENT_PRESETS[0].color);
  });

  it("switches the OLED true-black theme on mobile when dark", () => {
    toMobile();
    setOled(true);
    setThemeMode("dark");
    expect(themeAttr()).toBe("oled");
  });

  it("keeps the normal dark theme on desktop even with OLED on", () => {
    setOled(true);
    setThemeMode("dark");
    expect(themeAttr()).toBe("dark");
  });

  it("never applies OLED to the light theme", () => {
    toMobile();
    setOled(true);
    setThemeMode("light");
    expect(themeAttr()).toBe("light");
  });
});

describe("per-server override", () => {
  it("resolves the server override over the global mode", () => {
    setThemeMode("light");
    setServerThemeOverride("srv-a", "dark");
    setThemeServer("srv-a");
    expect(effectiveMode("srv-a")).toBe("dark");
    expect(themeAttr()).toBe("dark");
  });

  it("falls back to the global mode without an override", () => {
    setThemeMode("light");
    setThemeServer("srv-a");
    expect(effectiveMode("srv-a")).toBe("light");
    expect(themeAttr()).toBe("light");
  });

  it("leaves other servers on the global mode", () => {
    setThemeMode("dark");
    setServerThemeOverride("srv-a", "light");
    expect(effectiveMode("srv-b")).toBe("dark");
    expect(serverThemeOverride("srv-a")).toBe("light");
    expect(serverThemeOverride("srv-b")).toBeUndefined();
  });

  it("re-applies the global mode when leaving the server", () => {
    setThemeMode("dark");
    setServerThemeOverride("srv-a", "light");
    setThemeServer("srv-a");
    expect(themeAttr()).toBe("light");
    setThemeServer(undefined);
    expect(themeAttr()).toBe("dark");
  });

  it("clears an override and follows the global mode again", () => {
    setThemeMode("dark");
    setServerThemeOverride("srv-a", "light");
    setThemeServer("srv-a");
    clearServerThemeOverride("srv-a");
    expect(themeAttr()).toBe("dark");
    expect(serverThemeOverride("srv-a")).toBeUndefined();
  });
});

describe("persistence", () => {
  it("persists the theme mode", () => {
    setThemeMode("light");
    expect(localStorage.getItem("oc-theme")).toBe("light");
    expect(themeMode()).toBe("light");
  });

  it("persists the accent", () => {
    setAccent("#123456");
    expect(localStorage.getItem("oc-accent")).toBe("#123456");
    expect(accent()).toBe("#123456");
  });

  it("persists the OLED flag", () => {
    setOled(true);
    expect(localStorage.getItem("oc-oled")).toBe("1");
    expect(oled()).toBe(true);
    setOled(false);
    expect(localStorage.getItem("oc-oled")).toBe("0");
    expect(oled()).toBe(false);
  });

  it("persists server overrides as a map", () => {
    setServerThemeOverride("srv-a", "light");
    expect(JSON.parse(localStorage.getItem("oc-theme-server") ?? "{}")).toEqual({
      "srv-a": "light",
    });
    clearServerThemeOverride("srv-a");
    expect(localStorage.getItem("oc-theme-server")).toBe("{}");
  });
});
