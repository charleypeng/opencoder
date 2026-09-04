// UI scale store (desktop): the global interface scale factor. The
// persisted value (localStorage `oc-ui-scale`) is a number clamped to
// [UI_SCALE_MIN, UI_SCALE_MAX] stepped by UI_SCALE_STEP; the default of
// 1 maps to the established 120% desktop physical size, so the Appearance
// settings slider presents that size as the intuitive 100% baseline.
// applyUiScale() writes the effective factor to the --ui-scale CSS variable, which
// the html rule in src/styles/index.css applies to the ROOT FONT-SIZE —
// every rem-based Tailwind utility (spacing, buttons, icons) and the rem
// type tokens grow proportionally, like the browser's font-size setting.
// The layout viewport and fixed-position popups keep their coordinates,
// so nothing drifts or clips. Mobile is exempt: the native Liquid Glass
// tab bar lives outside the webview and its safe-area reserve (rem-based)
// must stay aligned with it (the pre-read in index.html mirrors this
// gate). Every change applies instantly and persists; the General
// section's reset (clears every oc-* key) covers it too.

import { createSignal } from "solid-js";
import { platform } from "../platform/index.js";

export const UI_SCALE_KEY = "oc-ui-scale";
export const UI_SCALE_MIN = 0.9;
export const UI_SCALE_MAX = 1.6;
export const UI_SCALE_STEP = 0.05;
export const DEFAULT_UI_SCALE = 1;
export const UI_SCALE_BASE = 1.2;
export const UI_SCALE_VERSION_KEY = "oc-ui-scale-version";
const UI_SCALE_VERSION = "2";

/** Clamps a raw value to the allowed range and snaps it to the step
 *  (0.05); anything non-finite falls back to the default. */
export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_UI_SCALE;
  const snapped = Math.round(value / UI_SCALE_STEP) * UI_SCALE_STEP;
  const clamped = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, snapped));
  // Snap back to two decimals so stored/displayed values have no float
  // noise (e.g. 1.1500000000000001).
  return Math.round(clamped * 100) / 100;
}

function readScale(): number {
  try {
    const stored = localStorage.getItem(UI_SCALE_KEY);
    if (stored === null) return DEFAULT_UI_SCALE;

    const parsed = Number.parseFloat(stored);
    if (!Number.isFinite(parsed)) return DEFAULT_UI_SCALE;
    if (localStorage.getItem(UI_SCALE_VERSION_KEY) !== UI_SCALE_VERSION) {
      // Prior versions stored the physical factor directly. Rebase it so
      // the current visual size keeps its appearance while the readout is
      // expressed against the new 100% desktop baseline.
      const migrated = clampScale(clampScale(parsed) / UI_SCALE_BASE);
      persist(String(migrated));
      return migrated;
    }
    return clampScale(parsed);
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_UI_SCALE;
}

const [uiScale, setUiScaleSignal] = createSignal<number>(readScale());

export { uiScale };

/** Applies the physical scale to the document. Mobile always writes 1
 *  (the native glass tab bar must not scale with the web content). */
export function applyUiScale(): void {
  const scale = platform.kind === "mobile" ? 1 : uiScale() * UI_SCALE_BASE;
  document.documentElement.style.setProperty("--ui-scale", String(scale));
}

function persist(value: string): void {
  try {
    localStorage.setItem(UI_SCALE_KEY, value);
    localStorage.setItem(UI_SCALE_VERSION_KEY, UI_SCALE_VERSION);
  } catch {
    // Storage unavailable (private mode): the session keeps working.
  }
}

/** Sets the UI scale, applies it immediately and persists it. */
export function setUiScale(next: number): void {
  const clamped = clampScale(next);
  setUiScaleSignal(clamped);
  persist(String(clamped));
  applyUiScale();
}
