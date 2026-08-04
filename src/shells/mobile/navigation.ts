// Mobile navigation store (TASK-M7-03): per-tab push stacks + the active
// tab. Each of the four tabs owns its OWN stack (root page first); the
// active tab's stack top is what renders. Tab switches only flip
// `activeTab` — every stack survives, so each tab's navigation state is
// preserved (MobileShell's keep-alive rendering complements this: all tab
// roots stay mounted, CSS-hidden while inactive).
//
// back() pops the active tab's stack but never below its root page; system
// back / swipe-back (M7-10 / M7-06) will route through the same action.

import { createStore, produce } from "solid-js/store";

export type TabId = "sessions" | "files" | "terminal" | "settings";

/** Tab order, matching the native UITabBar item order (glass bridge uses
 *  this 0-based index). */
export const TAB_ORDER: readonly TabId[] = ["sessions", "files", "terminal", "settings"];

export interface Route {
  /** Page registry key (see src/shells/mobile/pages.tsx). */
  page: string;
  /** Page params (e.g. `{ sessionId }`). */
  params?: Record<string, string>;
}

export interface NavState {
  activeTab: TabId;
  /** One stack per tab; every stack always holds at least its root route. */
  stacks: Record<TabId, Route[]>;
}

/** The root page key of each tab (its stack bottom). */
export const TAB_ROOT_PAGE: Record<TabId, string> = {
  sessions: "sessions",
  files: "files",
  terminal: "terminal",
  settings: "settings",
};

function makeInitialState(): NavState {
  return {
    activeTab: "sessions",
    stacks: {
      sessions: [{ page: TAB_ROOT_PAGE.sessions }],
      files: [{ page: TAB_ROOT_PAGE.files }],
      terminal: [{ page: TAB_ROOT_PAGE.terminal }],
      settings: [{ page: TAB_ROOT_PAGE.settings }],
    },
  };
}

export const [nav, setNav] = createStore<NavState>(makeInitialState());

/** The stack of the given (or active) tab. */
export function stackOf(tab: TabId = nav.activeTab): Route[] {
  return nav.stacks[tab];
}

/** The top (visible) route of the given (or active) tab. */
export function topOf(tab: TabId = nav.activeTab): Route {
  const stack = nav.stacks[tab];
  return stack[stack.length - 1];
}

/** Pushes a route onto the given (or active) tab's stack. */
export function push(route: Route, tab: TabId = nav.activeTab): void {
  setNav(
    produce((draft) => {
      draft.stacks[tab] = [...draft.stacks[tab], route];
    }),
  );
}

/** Pops the given (or active) tab's stack; a no-op at the root page. */
export function back(tab: TabId = nav.activeTab): void {
  setNav(
    produce((draft) => {
      if (draft.stacks[tab].length <= 1) return;
      draft.stacks[tab] = draft.stacks[tab].slice(0, -1);
    }),
  );
}

/** Switches the active tab; every tab's stack is untouched. */
export function selectTab(tab: TabId): void {
  setNav("activeTab", tab);
}

/** Resets navigation to the initial state (tests). */
export function resetNav(): void {
  setNav(makeInitialState());
}
