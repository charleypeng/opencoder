// Platform capability table (docs/architecture.md §3): which features each
// platform kind supports. Static booleans resolved from the Platform; where
// a feature also needs a RUNTIME signal (e.g. the iOS glass bridge), the
// consumer checks that signal at use time (see src/shells/mobile/glass.ts).

import type { Platform } from "./index.js";

export interface Capabilities {
  /** Desktop-only: the coding pet companion (M9). */
  supportsPet: boolean;
  /** Desktop-only: global hotkeys for the command palette (M8). */
  supportsGlobalShortcut: boolean;
  /** Desktop-only: system tray integration. */
  supportsTray: boolean;
  /** iOS: native Liquid Glass UITabBar injected by tauri-plugin-glass. */
  supportsNativeGlass: boolean;
  /** Android: the hardware back button drives the navigation stack (M7-10). */
  supportsSystemBack: boolean;
}

export function capabilitiesOf(platform: Platform): Capabilities {
  const mobile = platform.kind === "mobile";
  return {
    supportsPet: !mobile,
    supportsGlobalShortcut: !mobile,
    supportsTray: !mobile,
    supportsNativeGlass: platform.kind === "mobile" && platform.os === "ios",
    supportsSystemBack: platform.kind === "mobile" && platform.os === "android",
  };
}
