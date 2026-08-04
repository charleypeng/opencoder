// Mobile shell placeholder (TASK-M1-08): the mobile workspace (bottom-tab
// navigation, sheets, gestures) lands in M7 together with platform
// detection. App.tsx currently mounts DesktopShell for every platform; this
// component is the seam for `platform.kind === "mobile"` once src/platform/
// exists (see docs/architecture.md §3).
//
// (M7-02 spike) Temporary Liquid Glass demo: registers the native -> web
// handlers pushed by the glass plugin (src-tauri/plugins/glass) and exercises
// the web -> native bridge. Removed when the real shell lands (TASK-M7-03).

import { createSignal, onCleanup, onMount } from "solid-js";
import type { Component } from "solid-js";

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        glassBridge?: { postMessage: (message: unknown) => void };
      };
    };
    __glassTabSelected?: (index: number) => void;
    __glassNativePing?: (message: string) => void;
  }
}

const hasGlassBridge = () => typeof window.webkit?.messageHandlers?.glassBridge === "object";

const MobileShell: Component = () => {
  const [tabIndex, setTabIndex] = createSignal(-1);
  const [eventCount, setEventCount] = createSignal(0);
  const [ping, setPing] = createSignal("-");
  const [nextAuto, setNextAuto] = createSignal("starts in 2s");

  const post = (type: string, index?: number) => {
    window.webkit?.messageHandlers?.glassBridge?.postMessage(
      index === undefined ? { type } : { type, index },
    );
  };

  onMount(() => {
    // (M7-02 spike) Native -> web handlers installed by GlassPlugin.swift.
    window.__glassTabSelected = (index) => {
      setTabIndex(index);
      setEventCount((count) => count + 1);
    };
    window.__glassNativePing = (message) => setPing(message);

    if (!hasGlassBridge()) {
      return;
    }

    // (M7-02 spike) Scripted demo: verifies the web -> native -> web round
    // trip from screenshots alone (no manual tap required).
    const timers: number[] = [];
    const schedule = (fn: () => void, delay: number) => {
      timers.push(window.setTimeout(fn, delay));
    };
    const steps: Array<{ label: string; run: () => void }> = [
      { label: "setActive(1)", run: () => post("setActive", 1) },
      { label: "ping", run: () => post("ping") },
      { label: "setActive(2)", run: () => post("setActive", 2) },
    ];
    let step = 0;
    const next = () => {
      if (step >= steps.length) {
        setNextAuto("done");
        return;
      }
      const item = steps[step];
      step += 1;
      setNextAuto(`${item.label} in 2s`);
      schedule(() => {
        item.run();
        setNextAuto(`${item.label} sent`);
        schedule(next, 2000);
      }, 2000);
    };
    schedule(next, 2000);
    onCleanup(() => timers.forEach((timer) => window.clearTimeout(timer)));
  });

  return (
    // pb-44 keeps the demo content above the native tab bar (content padding
    // pattern from docs/ui-design.md §5, tier A).
    <div class="min-h-screen bg-bg-base pb-44 text-fg-primary" data-testid="mobile-shell">
      <div class="flex min-h-screen flex-col items-center justify-center gap-3">
        <p class="text-sm text-fg-secondary">Mobile shell — M7 (M7-02 glass spike)</p>
        <p class="text-xs text-fg-secondary">
          native tabSelected events: {eventCount()} · last tab: {tabIndex()}
        </p>
        <p class="text-xs text-fg-secondary">native ping: {ping()}</p>
        <p class="text-xs text-fg-secondary">next auto: {nextAuto()}</p>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
            onClick={() => post("setActive", 1)}
          >
            JS→Native setActive(1)
          </button>
          <button
            type="button"
            class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
            onClick={() => post("ping")}
          >
            JS→Native ping
          </button>
        </div>
      </div>
    </div>
  );
};

export default MobileShell;
