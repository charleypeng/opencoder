// Open bottom-sheet registry (TASK-M7-10): every Sheet instance registers
// itself while open so the Android system back handler (services/
// androidBack.ts) can resolve "is a sheet open, and may back close it?"
// without reaching into each sheet's private state. Sheets register with
// their identity, their dismissibility and their close action; the
// registry keeps insertion order so the MOST RECENTLY opened sheet is the
// top one. Pinned sheets (permission / question — must be answered, not
// skipped, TASK-M7-05) register with dismissible=false: the back resolver
// treats them as blocking, never closes them.

import { createSignal } from "solid-js";

export interface SheetEntry {
  /** Stable identity (one entry per sheet instance). */
  id: string;
  /** False = pinned (permission/question): the system back never closes
   *  it, only dismissible sheets are closed first. */
  dismissible: boolean;
  /** Dismiss action, invoked only for dismissible sheets. */
  close: () => void;
}

const [openSheets, setOpenSheets] = createSignal<SheetEntry[]>([]);

/** Registers an open sheet (or removes it when `entry` is null). */
export function registerSheet(id: string, entry: SheetEntry | null): void {
  setOpenSheets((prev) => {
    const without = prev.filter((sheet) => sheet.id !== id);
    return entry === null ? without : [...without, entry];
  });
}

/** The most recently opened sheet, or null when none is open. */
export function topSheet(): SheetEntry | null {
  const sheets = openSheets();
  return sheets.length === 0 ? null : sheets[sheets.length - 1];
}

/** Dismisses the top sheet when it is dismissible (no-op otherwise). */
export function closeTopSheet(): void {
  const sheet = topSheet();
  if (sheet !== null && sheet.dismissible) sheet.close();
}

/** Clears the registry (tests). */
export function resetSheets(): void {
  setOpenSheets([]);
}
