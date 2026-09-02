import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ServerHome from "./features/servers/ServerHome";
import DesktopShell from "./shells/desktop/DesktopShell";
import MobileShell from "./shells/mobile/MobileShell";
import TitleBar from "./shells/desktop/TitleBar";
import PetShell from "./features/pet/PetShell";
import { setGlassBarHidden } from "./shells/mobile/glassControl.js";
import { platform } from "./platform";
import { setThemeServer } from "./stores/theme.js";
import type { ServerEntry } from "./services/servers";

// App shell (TASK-M1-06/08 + M7-03): the server navigation home is the
// landing page; opening a server mounts the workspace shell for the
// detected platform (src/platform, docs/architecture.md §3) — DesktopShell
// on desktop, MobileShell on iOS/Android. Platform detection is
// UA/WebView-based with a viewport fallback; it never changes at runtime.
//
// TASK-M7-04: on mobile the app starts on the servers home, which has NO
// bottom navigation — assert the native glass bar stays hidden here (the
// plugin starts hidden too); MobileShell shows it while the workspace is
// mounted and hides it again on unmount (src/shells/mobile/glassControl.ts).
//
// TASK-M8-04: on desktop the custom TitleBar (window chrome: drag region,
// traffic-light spacer on macOS, custom min/max/close on Windows/Linux)
// is mounted above the content so every desktop screen keeps its window
// controls — the content wrapper absorbs the remaining height, and the
// shells' roots use percentage heights (h-full / min-h-full) to fill it.
//
// TASK-M8-07: the pet window (label "pet", created Rust-side) loads the
// same app and renders the PetShell page instead of the workspace — the
// window label is the only route signal (no router is installed). The
// check is guarded (outside Tauri / IPC-less web builds never touch the
// window API), so the pet window and the main window share one bundle.

function App() {
  const [selected, setSelected] = createSignal<ServerEntry | null>(null);
  const [petWindow, setPetWindow] = createSignal(false);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  const [rightToolsOpen, setRightToolsOpen] = createSignal(true);
  const [rightToolsMaximized, setRightToolsMaximized] = createSignal(false);

  function toggleSidebar(): void {
    setSidebarCollapsed((collapsed) => !collapsed);
  }

  function toggleRightTools(): void {
    setRightToolsOpen((open) => {
      const next = !open;
      if (!next) setRightToolsMaximized(false);
      return next;
    });
  }

  function toggleRightToolsMaximized(): void {
    if (!rightToolsOpen()) setRightToolsOpen(true);
    setRightToolsMaximized((maximized) => !maximized);
  }

  function exitWorkspace(): void {
    setSelected(null);
    setSidebarCollapsed(false);
    setRightToolsOpen(true);
    setRightToolsMaximized(false);
  }

  // TASK-M9-03: the theme store follows the active server — a per-server
  // override wins over the global mode and the resolved theme (incl. the
  // startup default) is re-applied on every switch, matching the no-flicker
  // pre-read in index.html.
  createEffect(() => {
    setThemeServer(selected()?.id);
  });

  onMount(() => {
    // The native WebView context menu exposes reload and inspector actions in
    // development, but must stay unavailable in release builds.
    if (import.meta.env.PROD) {
      const preventContextMenu = (event: MouseEvent): void => event.preventDefault();
      window.addEventListener("contextmenu", preventContextMenu);
      onCleanup(() => window.removeEventListener("contextmenu", preventContextMenu));
    }
    if (window.__TAURI_INTERNALS__ !== undefined) {
      try {
        setPetWindow(getCurrentWindow().label === "pet");
      } catch {
        // Window metadata unavailable: treat as the main window.
      }
    }
    if (platform.kind === "mobile") setGlassBarHidden();
  });

  return (
    <Show
      when={!petWindow()}
      fallback={
        <div class="h-dvh w-full">
          <PetShell />
        </div>
      }
    >
      <div class="flex h-dvh flex-col">
        <Show when={platform.kind === "desktop"}>
          <TitleBar
            sidebarCollapsed={sidebarCollapsed()}
            onToggleSidebar={selected() === null ? undefined : toggleSidebar}
            rightToolsOpen={rightToolsOpen()}
            rightToolsMaximized={rightToolsMaximized()}
            onToggleRightTools={selected() === null ? undefined : toggleRightTools}
            onToggleRightToolsMaximized={
              selected() === null ? undefined : toggleRightToolsMaximized
            }
          />
        </Show>
        <div class="min-h-0 flex-1">
          <Show when={selected()} fallback={<ServerHome onSelect={setSelected} />}>
            {platform.kind === "mobile" ? (
              <MobileShell server={selected() as ServerEntry} onExit={exitWorkspace} />
            ) : (
              <DesktopShell
                server={selected() as ServerEntry}
                onExit={exitWorkspace}
                sidebarCollapsed={sidebarCollapsed()}
                onToggleSidebar={toggleSidebar}
                rightToolsOpen={rightToolsOpen()}
                rightToolsMaximized={rightToolsMaximized()}
                onToggleRightTools={toggleRightTools}
                onRightToolsMaximizedChange={setRightToolsMaximized}
              />
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}

export default App;
