// Shortcuts settings section (TASK-M8-01): lists the full default table
// with each shortcut's current combo. Clicking a combo enters capture mode
// (the next non-modifier key combination is read; Esc cancels); a captured
// combo that conflicts with another shortcut is rejected with an inline
// warning listing the conflicting entry. Customized shortcuts gain a per-
// row Reset; "Reset all" restores the whole default table. The capture
// listener runs in the capture phase and stops propagation so a captured
// key never reaches the global shortcut dispatcher.

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import {
  comboFromEvent,
  DEFAULT_SHORTCUTS,
  findConflicts,
  formatCombo,
  shortcutLabelKey,
  type Combo,
} from "./shortcuts.js";
import {
  effectiveCombo,
  isCustomized,
  resetAllShortcuts,
  resetShortcutCombo,
  saveShortcutCombo,
} from "./shortcutStore.js";
import { isMacPlatform } from "./useShortcuts.js";
import { useT } from "../../i18n/index.js";

interface ConflictState {
  /** The shortcut id whose capture was rejected. */
  id: string;
  /** The captured (rejected) combo. */
  combo: Combo;
  /** Labels of the shortcuts the combo conflicts with. */
  with: string[];
}

const ShortcutsSection: Component = () => {
  const t = useT();
  const [capturing, setCapturing] = createSignal<string | null>(null);
  const [conflict, setConflict] = createSignal<ConflictState | null>(null);

  // Capture listener: capture-phase + stopImmediatePropagation so the
  // captured key press cannot reach the registry dispatcher (both listen
  // on window when the settings view lives inside the shell).
  createEffect(() => {
    const id = capturing();
    if (id === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        setCapturing(null);
        return;
      }
      const combo = comboFromEvent(event);
      if (combo === null) return;
      // Build the effective table with the candidate combo for this entry
      // and reject when it conflicts with any other shortcut.
      const assignments: Record<string, Combo> = {};
      for (const shortcut of DEFAULT_SHORTCUTS) {
        assignments[shortcut.id] = shortcut.id === id ? combo : effectiveCombo(shortcut.id);
      }
      const hits = findConflicts(assignments).filter(
        (entry) => entry.first === id || entry.second === id,
      );
      if (hits.length > 0) {
        const involved = new Set<string>();
        for (const hit of hits) {
          involved.add(hit.first);
          involved.add(hit.second);
        }
        involved.delete(id);
        const labels = [...involved].map((otherId) => {
          const shortcut = DEFAULT_SHORTCUTS.find((entry) => entry.id === otherId);
          return shortcut === undefined
            ? otherId
            : `${t(shortcutLabelKey(shortcut.id))} (${formatCombo(effectiveCombo(otherId), isMacPlatform())})`;
        });
        setConflict({ id, combo, with: labels });
        setCapturing(null);
        return;
      }
      saveShortcutCombo(id, combo);
      setConflict(null);
      setCapturing(null);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, { capture: true }));
  });

  return (
    <div data-testid="shortcuts-section" class="flex min-h-0 flex-1 flex-col">
      <div class="flex shrink-0 items-center justify-between gap-2 border-b border-bg-sunken px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold">{t("settings:shortcuts")}</h2>
          <p class="text-xs text-fg-secondary">{t("settings:shortcutHint")}</p>
        </div>
        <button
          type="button"
          data-testid="shortcut-reset-all"
          class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary"
          onClick={() => {
            resetAllShortcuts();
            setConflict(null);
            setCapturing(null);
          }}
        >
          {t("settings:resetAll")}
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <For each={DEFAULT_SHORTCUTS}>
          {(shortcut) => (
            <div
              data-testid={`shortcut-row-${shortcut.id}`}
              class="flex items-center gap-2 border-b border-bg-sunken px-2 py-2"
            >
              <span
                data-testid={`shortcut-label-${shortcut.id}`}
                class="min-w-0 flex-1 truncate text-xs"
              >
                {t(shortcutLabelKey(shortcut.id))}
              </span>
              <button
                type="button"
                data-testid={`shortcut-combo-${shortcut.id}`}
                aria-label={t("settings:changeShortcutFor", {
                  label: t(shortcutLabelKey(shortcut.id)),
                })}
                class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1 font-mono text-xs text-fg-default outline-none transition-colors hover:border-fg-faint"
                onClick={() => {
                  setConflict(null);
                  setCapturing((current: string | null) =>
                    current === shortcut.id ? null : shortcut.id,
                  );
                }}
              >
                {capturing() === shortcut.id
                  ? t("settings:pressKeys")
                  : formatCombo(effectiveCombo(shortcut.id), isMacPlatform())}
              </button>
              <Show when={isCustomized(shortcut.id)}>
                <button
                  type="button"
                  data-testid={`shortcut-reset-${shortcut.id}`}
                  aria-label={t("settings:resetShortcut", {
                    label: t(shortcutLabelKey(shortcut.id)),
                  })}
                  class="shrink-0 rounded-md px-2 py-1 text-xs text-fg-secondary outline-none hover:text-fg-primary"
                  onClick={() => {
                    resetShortcutCombo(shortcut.id);
                    setConflict(null);
                  }}
                >
                  {t("settings:reset")}
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
      <Show when={capturing() !== null}>
        <div
          data-testid="shortcut-capture-hint"
          class="shrink-0 border-t border-bg-sunken px-4 py-2"
        >
          <p class="text-xs text-fg-secondary">{t("settings:shortcutRecording")}</p>
        </div>
      </Show>
      <Show when={conflict()} keyed>
        {(state) => (
          <div
            data-testid="shortcut-conflict-warning"
            role="alert"
            class="shrink-0 border-t border-danger/30 bg-danger/10 px-4 py-2"
          >
            <p class="text-xs text-danger">
              {t("settings:shortcutConflict", {
                combo: formatCombo(state.combo, isMacPlatform()),
                others: state.with.map((id) => t(shortcutLabelKey(id))).join(", "),
              })}
            </p>
          </div>
        )}
      </Show>
    </div>
  );
};

export default ShortcutsSection;
