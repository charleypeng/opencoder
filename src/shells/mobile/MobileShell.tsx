// Mobile workspace shell (TASK-M7-03): four bottom tabs (Sessions / Files /
// Terminal / Settings) with per-tab push navigation (src/shells/mobile/
// navigation.ts) and keep-alive tab roots — all four tabs stay mounted,
// CSS-hidden while inactive, so each tab's scroll/input state survives
// switching (the TerminalPanel tabs pattern).
//
// Bottom navigation: on iOS with the glass plugin bridge reachable (M7-02
// concluded: tier A — native Liquid Glass UITabBar), the web nav is hidden
// entirely and the content reserves space under the native bar
// (pb-safe-bar — the bar's height plus the home-indicator inset, M7-04).
// Native tab taps arrive via window.__glassTabSelected and route through
// the same selectTab action. Everywhere else (Android Material 3 style web
// nav, iOS without the bridge) the web nav renders; when the bridge exists
// it mirrors the native bar via the setActive message.
//
// TASK-M7-04 (safe areas & keyboard): the native bar is GATED — the
// plugin starts with it hidden and this shell shows it on mount
// (setGlassBarShown) and hides it again on unmount (setGlassBarHidden),
// so the servers home never shows a bar with inert tabs; the shell root
// uses 100dvh so the keyboard-resized viewport (interactive-widget=
// resizes-content in index.html) leaves the bottom chrome visible above
// it, and the web nav pads the home-indicator inset (pb-safe).

import { For, onCleanup, onMount, Show, Suspense } from "solid-js";
import type { Component, JSX } from "solid-js";
import type { ServerEntry } from "../../services/servers";
import { startHapticEvents } from "../../services/hapticEvents.js";
import { startAndroidBack } from "../../services/androidBack.js";
import { startShareReceive } from "../../services/shareReceive.js";
import { capabilitiesOf } from "../../platform/capabilities";
import { platform } from "../../platform";
import { prefillComposer } from "../../stores/composer.js";
import { closeTopSheet, topSheet } from "../../stores/sheets.js";
import { hasGlassBridge, installGlassTabHandler, postGlassMessage } from "./glass.js";
import { setGlassBarHidden, setGlassBarShown } from "./glassControl.js";
import { back, nav, selectTab, TAB_ORDER, topOf } from "./navigation.js";
import type { TabId } from "./navigation.js";
import { pageRegistry, NotFoundPage } from "./pages.js";
import type { MobilePage } from "./pages.js";
import { pageEnterClass, pageEnterDir, routeKey } from "./transitions.js";
import PermissionSheet from "../../features/permissions/PermissionSheet.js";
import QuestionSheet from "../../features/questions/QuestionSheet.js";
import { useT } from "../../i18n/index.js";

export interface MobileShellProps {
  /** The server opened from the home screen (initially active). */
  server: ServerEntry;
  /** Called to leave the workspace and return to the servers home. */
  onExit: () => void;
}

const TAB_LABEL_KEYS: Record<TabId, string> = {
  sessions: "mobile:sessions",
  files: "mobile:files",
  terminal: "mobile:terminal",
  settings: "mobile:settings",
};

const TAB_ICONS: Record<TabId, JSX.Element> = {
  sessions: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  files: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  terminal: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
    >
      <path d="m4 7 5 5-5 5M12 17h8" />
    </svg>
  ),
  settings: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
};

const MobileShell: Component<MobileShellProps> = (props) => {
  const t = useT();
  // Native glass mode: iOS platform + the glass bridge actually reachable.
  // Resolved once per mount (the platform never changes at runtime).
  const nativeGlass = capabilitiesOf(platform).supportsNativeGlass && hasGlassBridge();

  // M7-07 page transitions: the last rendered stack depth per tab decides
  // the enter animation of the next page (push slides in from the right,
  // pop from the left). Initialized to 1 — every stack starts at its root
  // page — so the first render animates nothing.
  const prevDepth: Record<TabId, number> = { sessions: 1, files: 1, terminal: 1, settings: 1 };

  onMount(() => {
    // Native -> web: route native bar taps through the same selectTab
    // action the web nav uses; cleanup restores any previous handler.
    const cleanup = installGlassTabHandler((index) => {
      const tab = TAB_ORDER[index];
      if (tab !== undefined) selectTab(tab);
    });
    onCleanup(cleanup);
    // TASK-M7-04: the workspace owns the bottom edge — show the native
    // bar (the plugin starts hidden for the servers home) and hide it
    // again when the workspace unmounts (back to home).
    setGlassBarShown();
    onCleanup(() => setGlassBarHidden());
    // TASK-M7-07: haptic events (session complete / error, permission
    // asked) — the facade itself no-ops outside Tauri mobile.
    onCleanup(startHapticEvents(props.server.id));
    // TASK-M7-10: Android system back drives the navigation stack — a
    // dismissible sheet closes first, then the active tab's stack pops;
    // with nothing to handle the native listener is dropped so Android's
    // default (background the app) resumes. Mounted on Android only
    // (supportsSystemBack); the facade additionally guards Tauri.
    if (capabilitiesOf(platform).supportsSystemBack) {
      const backController = startAndroidBack({
        getContext: () => {
          const sheet = topSheet();
          return {
            sheet: sheet === null ? null : { dismissible: sheet.dismissible },
            stackDepth: nav.stacks[nav.activeTab].length,
          };
        },
        handlers: {
          closeSheet: () => closeTopSheet(),
          pop: () => back(),
        },
      });
      onCleanup(() => backController.dispose());
    }
    // TASK-M7-10: Android share receive — a shared text (native intent
    // via the future Kotlin bridge, docs/tasks/M7.md appendix) prefills
    // the active session's composer; the facade no-ops elsewhere.
    const shareController = startShareReceive({ onShareText: (text) => prefillComposer(text) });
    onCleanup(() => shareController.dispose());
  });

  /** Renders the top route of one tab through the page registry. The
   *  wrapper div is keyed by the route identity, so a route change
   *  remounts it and replays the M7-07 enter animation. */
  function renderTop(tab: TabId) {
    const route = topOf(tab);
    const Page: MobilePage = pageRegistry[route.page] ?? NotFoundPage;
    const depth = nav.stacks[tab].length;
    const dir = pageEnterDir(prevDepth[tab], depth);
    prevDepth[tab] = depth;
    return (
      <Show keyed when={routeKey(route)}>
        {(routeId) => (
          <div
            data-testid={`mobile-page-route-${tab}`}
            data-route-key={routeId}
            class={`h-full ${pageEnterClass(dir)}`}
          >
            {/* TASK-M9-08: lazy pages (the terminal tab) render through a
              Suspense boundary with a blank surface fallback. */}
            <Suspense fallback={<div class="h-full" />}>
              <Page serverId={props.server.id} onExit={props.onExit} route={route} />
            </Suspense>
          </div>
        )}
      </Show>
    );
  }

  return (
    <div
      data-testid="mobile-shell"
      data-native-glass={nativeGlass ? "true" : "false"}
      class="flex h-dvh min-h-0 flex-col bg-bg-base text-fg-primary"
    >
      {/* Keep-alive tab pages: all four stay mounted, hidden while inactive
          (each tab's state survives switching). pb-safe-bar reserves space
          under the native bar — bar height plus home-indicator inset —
          when it owns the bottom edge (TASK-M7-04). */}
      <main
        data-testid="mobile-content"
        class={`min-h-0 flex-1 ${nativeGlass ? "pb-safe-bar" : ""}`}
      >
        <For each={TAB_ORDER}>
          {(tab) => (
            <div
              data-testid={`mobile-page-${tab}`}
              data-active={nav.activeTab === tab ? "true" : "false"}
              class={nav.activeTab === tab ? "h-full" : "hidden"}
            >
              {renderTop(tab)}
            </div>
          )}
        </For>
      </main>

      {/* Web nav (Android Material 3 style + iOS fallback without the
          plugin): hidden while the native bar is in charge. pb-safe pads
          the home-indicator inset (TASK-M7-04). Glass styling (tier B,
          ui-design §5) gives the nav bar a translucent frosted background
          with border highlight matching the design tokens. */}
      <nav
        data-testid="mobile-nav"
        aria-label={t("mobile:mainNavigation")}
        class={nativeGlass ? "hidden" : "glass flex shrink-0 border-t pb-safe"}
        style={!nativeGlass ? { "border-color": "var(--glass-border)" } : undefined}
      >
        <For each={TAB_ORDER}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              data-testid={`mobile-tab-${tab}`}
              aria-selected={nav.activeTab === tab ? "true" : "false"}
              class={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium outline-none transition-colors ${
                nav.activeTab === tab ? "text-accent" : "text-fg-secondary hover:text-fg-primary"
              }`}
              style={{ "min-height": "44px" }}
              onClick={() => {
                selectTab(tab);
                // Mirror web taps on the native bar when the bridge exists.
                postGlassMessage({ type: "setActive", index: TAB_ORDER.indexOf(tab) });
              }}
            >
              {TAB_ICONS[tab]}
              {t(TAB_LABEL_KEYS[tab])}
            </button>
          )}
        </For>
      </nav>

      {/* Permission sheet (TASK-M5-01) mobile presentation (TASK-M7-05):
          the queue head renders as a bottom sheet; pinned — a permission
          must be answered, not skipped. */}
      <PermissionSheet serverId={props.server.id} variant="sheet" />

      {/* Question sheet (TASK-M5-02) mobile presentation (TASK-M7-05):
          same bottom-sheet treatment as the permission queue. */}
      <QuestionSheet serverId={props.server.id} variant="sheet" />
    </div>
  );
};

export default MobileShell;
