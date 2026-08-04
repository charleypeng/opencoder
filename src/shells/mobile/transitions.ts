// Page transition helper (TASK-M7-07): decides the enter-animation class
// for a MobileShell page from its stack depth delta — a push slides the
// incoming page in from the right, a pop slides it in from the left, an
// unchanged depth (initial mount / tab switches) animates nothing. The
// pure functions are unit-tested; MobileShell tracks the per-tab previous
// depth and applies the class on the keyed page wrapper. The shared-element
// transition (session row -> chat header, ui-design §4.1) is rendered as a
// simplified scale-fade on the Chat page itself (page-enter-zoom) — a full
// FLIP shared element is deferred (see docs/tasks/M7.md appendix).

import type { Route } from "./navigation.js";

export type PageEnterDir = "forward" | "back" | "none";

/** Maps a stack depth delta to the enter direction. */
export function pageEnterDir(prevDepth: number, nextDepth: number): PageEnterDir {
  if (nextDepth > prevDepth) return "forward";
  if (nextDepth < prevDepth) return "back";
  return "none";
}

/** Maps the enter direction to the CSS class (empty for none). */
export function pageEnterClass(dir: PageEnterDir): string {
  switch (dir) {
    case "forward":
      return "page-enter-forward";
    case "back":
      return "page-enter-back";
    case "none":
      return "";
  }
}

/** Stable identity of a route; used as the remount key for the page
 *  wrapper so a route change replays the enter animation. */
export function routeKey(route: Route): string {
  const params = route.params;
  if (params === undefined || Object.keys(params).length === 0) return route.page;
  return `${route.page}:${params.sessionId ?? ""}`;
}
