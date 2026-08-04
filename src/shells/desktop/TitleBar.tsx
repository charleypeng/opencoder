// Desktop window chrome (TASK-M8-04): the custom title bar rendered above
// every desktop screen. On macOS the window keeps native decorations with
// the overlay title-bar style (tauri.macos.conf.json), so the system
// traffic lights float above the bar and the left spacer clears them — no
// custom buttons are drawn. On Windows/Linux the window is undecorated
// (tauri.windows.conf.json / tauri.linux.conf.json) and the minimize /
// maximize / close buttons are drawn at the right edge. The bar is a Tauri
// drag region (`data-tauri-drag-region="deep"`): the drag script Tauri
// injects handles window dragging and double-click maximize natively
// (internal_toggle_maximize; on macOS the zoom fires on mouseup and is
// cancellable, matching the system behavior) and blocks drags on clickable
// elements, so the control buttons keep working. In a plain browser (web
// build / L2 tests) the bar renders without any window API access and
// hides the (no-op) window controls.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "../../platform/index.js";

const TitleBar: Component = () => {
  const tauri = isTauri();
  const mac = platform.kind === "desktop" && platform.os === "macos";
  const [maximized, setMaximized] = createSignal(false);

  // Lazily bound window API; only non-null inside Tauri. `onResized` keeps
  // the maximize/restore icon truthful when the state changes from outside
  // the button (keyboard shortcut, snap, window-state restore).
  let windowApi: ReturnType<typeof getCurrentWindow> | null = null;
  let unlistenResized: (() => void) | undefined;

  onMount(() => {
    if (!tauri) return;
    const win = getCurrentWindow();
    windowApi = win;
    void win.isMaximized().then(setMaximized);
    void win
      .onResized(() => void win.isMaximized().then(setMaximized))
      .then((unlisten) => {
        unlistenResized = unlisten;
      });
  });

  onCleanup(() => unlistenResized?.());

  async function handleToggleMaximize() {
    if (windowApi === null) return;
    await windowApi.toggleMaximize();
    void windowApi.isMaximized().then(setMaximized);
  }

  return (
    <header
      data-testid="titlebar"
      data-tauri-drag-region="deep"
      data-window-controls={mac ? "mac" : "custom"}
      class={`flex h-[38px] shrink-0 select-none items-center border-b border-bg-sunken bg-bg-elevated text-fg-secondary ${
        mac ? "pl-[78px]" : "pl-3"
      }`}
    >
      <span class="flex min-w-0 items-center gap-2">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4 shrink-0 text-accent"
          aria-hidden="true"
        >
          <path d="m8 5 8 7-8 7V5z" />
        </svg>
        <span data-testid="titlebar-title" class="truncate text-xs font-medium">
          opencoder
        </span>
      </span>
      <div class="min-w-0 flex-1" />
      <Show when={!mac && tauri}>
        <div class="flex h-full items-stretch">
          <button
            type="button"
            data-testid="titlebar-minimize"
            aria-label="Minimize"
            title="Minimize"
            class="flex w-[46px] items-center justify-center text-fg-secondary outline-none transition-colors hover:bg-bg-sunken hover:text-fg-primary"
            onClick={() => void windowApi?.minimize()}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              class="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            data-testid="titlebar-maximize"
            aria-label={maximized() ? "Restore" : "Maximize"}
            title={maximized() ? "Restore" : "Maximize"}
            class="flex w-[46px] items-center justify-center text-fg-secondary outline-none transition-colors hover:bg-bg-sunken hover:text-fg-primary"
            onClick={() => void handleToggleMaximize()}
          >
            <Show
              when={maximized()}
              fallback={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <rect x="5" y="5" width="14" height="14" rx="1.5" />
                </svg>
              }
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <rect x="7.5" y="7.5" width="11" height="11" rx="1.5" />
                <path d="M4 13.5V6.5A2.5 2.5 0 0 1 6.5 4h7" />
              </svg>
            </Show>
          </button>
          <button
            type="button"
            data-testid="titlebar-close"
            aria-label="Close"
            title="Close"
            class="flex w-[46px] items-center justify-center text-fg-secondary outline-none transition-colors hover:bg-danger hover:text-white"
            onClick={() => void windowApi?.close()}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              class="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </Show>
    </header>
  );
};

export default TitleBar;
