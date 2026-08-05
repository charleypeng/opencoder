// Theme store (TASK-M9-03): the two-level theme memory and the accent
// color. The global mode is "dark" | "light" | "system" (localStorage
// `oc-theme`, default "system"), the accent is one of the six preset ids
// or a custom hex (`oc-accent`), OLED true-black is a mobile-only boolean
// (`oc-oled`), and per-server overrides live in a serverId -> mode map
// (`oc-theme-server`). applyTheme() resolves the effective mode (server
// override ?? global, "system" through matchMedia) and writes
// documentElement dataset.theme (dark / light / the mobile-only "oled")
// plus the --accent CSS variable — --accent-soft derives from --accent via
// color-mix in tokens.css, so presets and custom colors share one path.
// index.html carries a no-flicker pre-read that mirrors this resolution
// before the bundle runs; App calls setThemeServer on every server change
// so entering a server applies its override immediately.

import { createSignal } from "solid-js";
import { platform } from "../platform/index.js";

export type ThemeMode = "dark" | "light" | "system";

export interface AccentPreset {
  /** Stable id persisted to localStorage. */
  id: string;
  /** The hex color applied to the --accent CSS variable. */
  color: string;
}

/** The six accent presets; the first is the default. */
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: "indigo", color: "#7c8cff" },
  { id: "emerald", color: "#34d399" },
  { id: "amber", color: "#fbbf24" },
  { id: "coral", color: "#f87171" },
  { id: "cyan", color: "#22d3ee" },
  { id: "purple", color: "#c084fc" },
];

export const THEME_MODES: readonly ThemeMode[] = ["dark", "light", "system"];

const MODE_KEY = "oc-theme";
const ACCENT_KEY = "oc-accent";
const OLED_KEY = "oc-oled";
const SERVER_KEY = "oc-theme-server";

const PRESET_BY_ID: ReadonlyMap<string, string> = new Map(
  ACCENT_PRESETS.map((preset) => [preset.id, preset.color]),
);

const HEX_RE = /^#[0-9a-f]{3,8}$/i;

/** The hex of the default accent preset. */
export const DEFAULT_ACCENT = ACCENT_PRESETS[0].color;

function readMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "dark" || stored === "light" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

function readAccent(): string {
  try {
    const stored = localStorage.getItem(ACCENT_KEY);
    if (stored !== null && (PRESET_BY_ID.has(stored) || HEX_RE.test(stored))) return stored;
  } catch {
    // Fall through to the default.
  }
  return ACCENT_PRESETS[0].id;
}

function readOled(): boolean {
  try {
    return localStorage.getItem(OLED_KEY) === "1";
  } catch {
    return false;
  }
}

function readServerOverrides(): Record<string, ThemeMode> {
  try {
    const raw = localStorage.getItem(SERVER_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== "object") return {};
    const overrides: Record<string, ThemeMode> = {};
    for (const [serverId, value] of Object.entries(parsed)) {
      if (value === "dark" || value === "light" || value === "system") {
        overrides[serverId] = value;
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

const [themeMode, setThemeModeSignal] = createSignal<ThemeMode>(readMode());
const [accent, setAccentSignal] = createSignal<string>(readAccent());
const [oled, setOledSignal] = createSignal<boolean>(readOled());
const [themeServerOverrides, setThemeServerOverridesSignal] =
  createSignal<Record<string, ThemeMode>>(readServerOverrides());

/** The currently active server (registered by App); undefined at the
 *  servers home. Its override wins over the global mode in applyTheme. */
let activeServerId: string | undefined;

export { themeMode, accent, oled, themeServerOverrides };

/** Resolves an accent value (preset id or hex) to a CSS color; anything
 *  unknown falls back to the default preset. */
export function accentColor(value: string): string {
  const preset = PRESET_BY_ID.get(value);
  if (preset !== undefined) return preset;
  return HEX_RE.test(value) ? value : DEFAULT_ACCENT;
}

/** Resolves a mode to a concrete theme, following the OS preference for
 *  "system" (matchMedia, guarded for engines without it). */
export function resolveMode(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode;
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** The mode in effect for a server: its override when set, else global. */
export function effectiveMode(serverId: string | undefined): ThemeMode {
  const override = serverId !== undefined ? themeServerOverrides()[serverId] : undefined;
  return override ?? themeMode();
}

/** The override pinned for one server, if any. */
export function serverThemeOverride(serverId: string): ThemeMode | undefined {
  return themeServerOverrides()[serverId];
}

/** Applies the effective theme to the document: dataset.theme (dark /
 *  light, or the mobile-only true-black "oled" while OLED is on) plus the
 *  --accent CSS variable. Safe to call any time; index.html pre-reads the
 *  same values so the first paint is already themed. */
export function applyTheme(): void {
  const resolved = resolveMode(effectiveMode(activeServerId));
  const theme = platform.kind === "mobile" && resolved === "dark" && oled() ? "oled" : resolved;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--accent", accentColor(accent()));
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode): the session keeps working.
  }
}

/** Switches the global theme mode and applies it immediately. */
export function setThemeMode(next: ThemeMode): void {
  setThemeModeSignal(next);
  persist(MODE_KEY, next);
  applyTheme();
}

/** Sets the accent (preset id or custom hex) and applies it immediately. */
export function setAccent(next: string): void {
  setAccentSignal(next);
  persist(ACCENT_KEY, next);
  applyTheme();
}

/** Toggles the mobile-only OLED true-black background. */
export function setOled(next: boolean): void {
  setOledSignal(next);
  persist(OLED_KEY, next ? "1" : "0");
  applyTheme();
}

/** Pins one server's own theme mode (the server-level memory). */
export function setServerThemeOverride(serverId: string, override: ThemeMode): void {
  const next = { ...themeServerOverrides(), [serverId]: override };
  setThemeServerOverridesSignal(next);
  persist(SERVER_KEY, JSON.stringify(next));
  applyTheme();
}

/** Removes one server's override so it follows the global mode again. */
export function clearServerThemeOverride(serverId: string): void {
  const next = { ...themeServerOverrides() };
  delete next[serverId];
  setThemeServerOverridesSignal(next);
  persist(SERVER_KEY, JSON.stringify(next));
  applyTheme();
}

/** Registers the active server (called by App on every server change) and
 *  re-applies the theme with its override in effect. */
export function setThemeServer(serverId: string | undefined): void {
  activeServerId = serverId;
  applyTheme();
}
