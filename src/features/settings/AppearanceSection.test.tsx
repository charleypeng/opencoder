// L2 tests for the Appearance settings section (TASK-M9-03): the theme
// mode buttons, the accent presets + custom hex input, the mobile-only
// OLED toggle, the per-server override sub-section (server ?? global), and
// the dark/light two-theme snapshots (the desktop cannot be screenshotted,
// so the L2 snapshot walkthrough covers both themes).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { refreshPlatform } from "../../platform/index.js";
import { DEFAULT_UI_SCALE, setUiScale } from "../../stores/uiScale.js";
import {
  ACCENT_PRESETS,
  setAccent,
  setOled,
  setThemeMode,
  setThemeServer,
} from "../../stores/theme.js";
import AppearanceSection from "./AppearanceSection";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

const SERVER = "srv-appearance";

function toMobile() {
  Object.defineProperty(window.navigator, "userAgent", {
    value: IPHONE_UA,
    configurable: true,
  });
  refreshPlatform();
}

function accentVar(): string {
  return document.documentElement.style.getPropertyValue("--accent");
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    configurable: true,
  });
  refreshPlatform();
  setThemeMode("system");
  setAccent(ACCENT_PRESETS[0].id);
  setOled(false);
  setThemeServer(undefined);
  setUiScale(DEFAULT_UI_SCALE);
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--accent");
  document.documentElement.style.removeProperty("--ui-scale");
});

afterEach(() => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    configurable: true,
  });
  refreshPlatform();
});

describe("AppearanceSection theme controls", () => {
  it("renders the global theme buttons and the server override sub-section", () => {
    render(() => <AppearanceSection serverId={SERVER} />);

    expect(screen.getByTestId("appearance-section")).toBeInTheDocument();
    expect(screen.getByTestId("theme-dark")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("theme-light")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("theme-system")).toBeInTheDocument();
    expect(screen.getByTestId("theme-server-override")).toBeInTheDocument();
    expect(screen.getByTestId("theme-server-follow")).toHaveAttribute("aria-pressed", "true");
  });

  it("switches the theme mode, applies it and persists it", () => {
    render(() => <AppearanceSection serverId={SERVER} />);

    fireEvent.click(screen.getByTestId("theme-light"));
    expect(screen.getByTestId("theme-light")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("theme-dark")).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("oc-theme")).toBe("light");

    fireEvent.click(screen.getByTestId("theme-dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("oc-theme")).toBe("dark");
  });
});

describe("AppearanceSection accent controls", () => {
  it("applies a preset accent and persists the id", () => {
    render(() => <AppearanceSection serverId={SERVER} />);

    fireEvent.click(screen.getByTestId("accent-preset-emerald"));
    expect(screen.getByTestId("accent-preset-emerald")).toHaveAttribute("aria-pressed", "true");
    expect(accentVar()).toBe("#34d399");
    expect(localStorage.getItem("oc-accent")).toBe("emerald");
  });

  it("applies a custom hex from the text input", () => {
    render(() => <AppearanceSection serverId={SERVER} />);

    const input = screen.getByTestId("accent-custom-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "#123abc" } });
    expect(accentVar()).toBe("#123abc");
    expect(localStorage.getItem("oc-accent")).toBe("#123abc");
    expect(screen.getByTestId("accent-custom")).toHaveAttribute("data-custom", "true");
  });

  it("ignores malformed hex input", () => {
    render(() => <AppearanceSection serverId={SERVER} />);

    const input = screen.getByTestId("accent-custom-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "#123abc" } });
    expect(accentVar()).toBe("#123abc");
    fireEvent.input(input, { target: { value: "red" } });
    expect(accentVar()).toBe("#123abc");
    expect(localStorage.getItem("oc-accent")).toBe("#123abc");
  });
});

describe("AppearanceSection OLED (mobile-only)", () => {
  it("hides the OLED toggle on desktop", () => {
    render(() => <AppearanceSection serverId={SERVER} />);
    expect(screen.queryByTestId("theme-oled")).not.toBeInTheDocument();
  });

  it("shows the OLED toggle on mobile and applies the true-black theme", () => {
    toMobile();
    setThemeMode("dark");
    render(() => <AppearanceSection serverId={SERVER} />);

    const toggle = screen.getByTestId("theme-oled");
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("oled");
    expect(localStorage.getItem("oc-oled")).toBe("1");

    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("oc-oled")).toBe("0");
  });
});

describe("AppearanceSection UI scale (desktop-only)", () => {
  it("shows the slider on desktop with the default value", () => {
    render(() => <AppearanceSection serverId={SERVER} />);

    const slider = screen.getByTestId("ui-scale-slider") as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.value).toBe("1");
    expect(screen.getByTestId("ui-scale-value")).toHaveTextContent("100%");
  });

  it("previews the scale while dragging and commits it on release", () => {
    // Earlier tests in this file persist the default; start clean.
    localStorage.removeItem("oc-ui-scale");
    render(() => <AppearanceSection serverId={SERVER} />);

    const slider = screen.getByTestId("ui-scale-slider") as HTMLInputElement;
    // Drag (input events): the readout previews, but nothing is applied —
    // a live apply re-layouts the dialog mid-drag and jitters the slider.
    fireEvent.input(slider, { target: { value: "1.4" } });
    expect(screen.getByTestId("ui-scale-value")).toHaveTextContent("140%");
    // Nothing applied yet: the CSS variable was never written with the
    // dragged value (the section test has no bootstrap apply, so the
    // meaningful assertion is "the drag did not apply 1.4").
    expect(document.documentElement.style.getPropertyValue("--ui-scale")).not.toBe("1.68");
    expect(localStorage.getItem("oc-ui-scale")).toBeNull();

    // Release (change): the draft commits and persists.
    fireEvent.change(slider, { target: { value: "1.4" } });
    expect(document.documentElement.style.getPropertyValue("--ui-scale")).toBe("1.68");
    expect(localStorage.getItem("oc-ui-scale")).toBe("1.4");
    expect(screen.getByTestId("ui-scale-value")).toHaveTextContent("140%");
  });

  it("hides the slider on mobile (native glass bar must not scale)", () => {
    toMobile();
    render(() => <AppearanceSection serverId={SERVER} />);
    expect(screen.queryByTestId("ui-scale-slider")).not.toBeInTheDocument();
  });
});

describe("AppearanceSection server override", () => {
  it("pins a server mode over the global one and re-applies it", () => {
    setThemeMode("dark");
    // App registers the active server when entering it (setThemeServer);
    // without a registered server the override cannot be in effect.
    setThemeServer(SERVER);
    render(() => <AppearanceSection serverId={SERVER} />);
    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(screen.getByTestId("theme-server-light"));
    expect(screen.getByTestId("theme-server-light")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("theme-server-follow")).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(JSON.parse(localStorage.getItem("oc-theme-server") ?? "{}")).toEqual({
      [SERVER]: "light",
    });
    // The override survives a server re-entry (App applies it on enter).
    setThemeServer(SERVER);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("restores the global mode through Follow global and Clear override", () => {
    setThemeMode("dark");
    render(() => <AppearanceSection serverId={SERVER} />);

    fireEvent.click(screen.getByTestId("theme-server-light"));
    expect(screen.queryByTestId("theme-server-clear")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("theme-server-follow"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByTestId("theme-server-follow")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("theme-server-clear")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("theme-server-dark"));
    expect(screen.queryByTestId("theme-server-clear")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("theme-server-clear"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.queryByTestId("theme-server-clear")).not.toBeInTheDocument();
  });
});

describe("AppearanceSection two-theme snapshot walkthrough", () => {
  it("matches the section snapshot in dark and light themes", () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.setProperty("--accent", ACCENT_PRESETS[0].color);
    render(() => <AppearanceSection serverId={SERVER} />);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.outerHTML).toMatchSnapshot("dark theme");

    fireEvent.click(screen.getByTestId("theme-light"));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.outerHTML).toMatchSnapshot("light theme");
  });
});
