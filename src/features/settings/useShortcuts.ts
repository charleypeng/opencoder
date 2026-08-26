// Shortcut dispatch hook (TASK-M8-01): registers one window keydown
// listener dispatching the given id→action map through the registry. The
// effective combo of every registered shortcut comes from the overrides
// store (custom combos re-wire reactively); dispatch gates on the shortcut
// scope vs. the shell's active scope signal, on the input guard (a plain-key
// shortcut must not steal a key while a text control is focused unless it
// opts out, like ⌘Enter and the server digits — a ⌘/Ctrl combo never types
// into the control, so modified shortcuts stay dispatchable while typing,
// e.g. ⌘K from the composer), and on `event.defaultPrevented` (a focused
// widget that handled the key, e.g. a dialog, wins). The primary modifier
// matches either ⌘ or Ctrl.

import { createEffect, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { platform } from "../../platform/index.js";
import { comboMatchesEvent, isTextControlTarget, shortcutById, type Scope } from "./shortcuts.js";
import { overrides } from "./shortcutStore.js";

/** A registered shortcut action; receives the raw keydown event. */
export type ShortcutAction = (event: KeyboardEvent) => void;

export interface UseShortcutsOptions {
  /** id → action map; only ids present here are dispatched. */
  actions: Record<string, ShortcutAction>;
  /** The shell's focused-region scope (default "global"). */
  activeScope: Accessor<Scope>;
}

function scopeAllows(scope: Scope, active: Scope): boolean {
  if (scope === "global") return true;
  return scope === active;
}

/** Registers the window keydown dispatcher; removes it on cleanup. */
export function useShortcuts(options: UseShortcutsOptions): void {
  createEffect(() => {
    // Read the store reactively so custom combos re-register the listener.
    const snapshot = { ...overrides };
    const entries = Object.entries(options.actions);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      for (const [id, action] of entries) {
        const shortcut = shortcutById(id);
        if (shortcut === undefined) continue;
        const value = snapshot[id] ?? shortcut.defaultCombo;
        if (!comboMatchesEvent(event, value)) continue;
        // A ⌘/Ctrl combo never types characters into the focused control,
        // so the input guard only blocks plain-key shortcuts (docs/ui-audit
        // V3: ⌘K/⌘P must work while typing).
        const modified = event.metaKey || event.ctrlKey;
        if (shortcut.inputGuard !== false && !modified && isTextControlTarget(target)) continue;
        if (!scopeAllows(shortcut.scope, options.activeScope())) continue;
        event.preventDefault();
        action(event);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });
}

/** Whether the current platform renders shortcuts with the ⌘ glyph. */
export function isMacPlatform(): boolean {
  return platform.os === "macos";
}
