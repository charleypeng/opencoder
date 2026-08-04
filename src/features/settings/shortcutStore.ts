// Shortcut customization store (TASK-M8-01): the per-shortcut combo
// overrides persisted in localStorage (`oc-shortcuts`), keyed by shortcut
// id. The store is the reactive source for the registry hook and the
// settings UI; the raw storage holds only valid combos for known ids
// (malformed or stale entries are dropped on load).

import { createStore, produce } from "solid-js/store";
import { shortcutById, type Combo } from "./shortcuts.js";

const STORAGE_KEY = "oc-shortcuts";

function isCombo(value: unknown): value is Combo {
  if (typeof value !== "object" || value === null) return false;
  const combo = value as Record<string, unknown>;
  return (
    typeof combo.key === "string" &&
    combo.key !== "" &&
    typeof combo.ctrl === "boolean" &&
    typeof combo.meta === "boolean" &&
    typeof combo.shift === "boolean" &&
    typeof combo.alt === "boolean"
  );
}

/** Reads the stored overrides (never throws; invalid entries are dropped). */
function readStored(): Record<string, Combo> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, Combo> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (isCombo(value) && shortcutById(id) !== undefined) out[id] = value;
    }
    return out;
  } catch {
    // Unreadable or blocked storage: fall back to the default table.
    return {};
  }
}

function writeStored(overrides: Record<string, Combo>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage unavailable (e.g. private mode): the in-memory store still works.
  }
}

const [overrides, setOverrides] = createStore<Record<string, Combo>>(readStored());

/** Reactive customization map (id → custom combo). */
export { overrides };

/** Whether the shortcut has a stored customization. */
export function isCustomized(id: string): boolean {
  return overrides[id] !== undefined;
}

/** The combo the registry dispatches for a shortcut (custom or default). */
export function effectiveCombo(id: string): Combo {
  const custom = overrides[id];
  if (custom !== undefined) return custom;
  const fallback = shortcutById(id);
  if (fallback === undefined) throw new Error(`Unknown shortcut "${id}"`);
  return fallback.defaultCombo;
}

/** Persists a custom combo for a shortcut. */
export function saveShortcutCombo(id: string, value: Combo): void {
  setOverrides(id, value);
  writeStored({ ...overrides });
}

/** Removes a shortcut's customization, restoring its default combo. */
export function resetShortcutCombo(id: string): void {
  setOverrides(
    produce((draft) => {
      delete draft[id];
    }),
  );
  writeStored({ ...overrides });
}

/** Restores the default combos for every shortcut. */
export function resetAllShortcuts(): void {
  setOverrides(
    produce((draft) => {
      for (const id of Object.keys(draft)) delete draft[id];
    }),
  );
  writeStored({});
}
