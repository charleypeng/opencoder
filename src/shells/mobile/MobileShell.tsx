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

import { For, onCleanup, onMount } from "solid-js";
import type { Component, JSX } from "solid-js";
import type { ServerEntry } from "../../services/servers";
import { capabilitiesOf } from "../../platform/capabilities";
import { platform } from "../../platform";
import { hasGlassBridge, installGlassTabHandler, postGlassMessage } from "./glass.js";
import { setGlassBarHidden, setGlassBarShown } from "./glassControl.js";
import { nav, selectTab, TAB_ORDER, topOf } from "./navigation.js";
import type { TabId } from "./navigation.js";
import { pageRegistry, NotFoundPage } from "./pages.js";
import type { MobilePage } from "./pages.js";

export interface MobileShellProps {
  /** The server opened from the home screen (initially active). */
  server: ServerEntry;
  /** Called to leave the workspace and return to the servers home. */
  onExit: () => void;
}

const TAB_LABELS: Record<TabId, string> = {
  sessions: "Sessions",
  files: "Files",
  terminal: "Terminal",
  settings: "Settings",
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
  // Native glass mode: iOS platform + the glass bridge actually reachable.
  // Resolved once per mount (the platform never changes at runtime).
  const nativeGlass = capabilitiesOf(platform).supportsNativeGlass && hasGlassBridge();

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
  });

  /** Renders the top route of one tab through the page registry. */
  function renderTop(tab: TabId) {
    const route = topOf(tab);
    const Page: MobilePage = pageRegistry[route.page] ?? NotFoundPage;
    return <Page serverId={props.server.id} onExit={props.onExit} route={route} />;
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
          the home-indicator inset (TASK-M7-04). */}
      <nav
        data-testid="mobile-nav"
        aria-label="Main navigation"
        class={
          nativeGlass ? "hidden" : "flex shrink-0 border-t border-bg-sunken bg-bg-elevated pb-safe"
        }
      >
        <For each={TAB_ORDER}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              data-testid={`mobile-tab-${tab}`}
              aria-selected={nav.activeTab === tab ? "true" : "false"}
              class={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium outline-none transition-colors ${
                nav.activeTab === tab ? "text-accent" : "text-fg-secondary hover:text-fg-primary"
              }`}
              onClick={() => {
                selectTab(tab);
                // Mirror web taps on the native bar when the bridge exists.
                postGlassMessage({ type: "setActive", index: TAB_ORDER.indexOf(tab) });
              }}
            >
              {TAB_ICONS[tab]}
              {TAB_LABELS[tab]}
            </button>
          )}
        </For>
      </nav>
    </div>
  );
};

export default MobileShell;
