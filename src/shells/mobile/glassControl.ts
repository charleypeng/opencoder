// Native glass bar visibility control (TASK-M7-04): the servers home has
// no bottom navigation — only the workspace shows the four tabs — so the
// web layer gates the native UITabBar through the glass bridge's
// setHidden message. The plugin starts with the bar hidden; MobileShell
// calls setGlassBarShown() on mount and setGlassBarHidden() on unmount,
// and App asserts the hidden state once on startup (mobile only). Every
// call is a no-op without the bridge (Android / bridge-less iOS fallback).

import { hasGlassBridge, postGlassMessage } from "./glass.js";

/** Shows the native glass tab bar (workspace mount). */
export function setGlassBarShown(): void {
  if (hasGlassBridge()) postGlassMessage({ type: "setHidden", hidden: false });
}

/** Hides the native glass tab bar (servers home). */
export function setGlassBarHidden(): void {
  if (hasGlassBridge()) postGlassMessage({ type: "setHidden", hidden: true });
}
