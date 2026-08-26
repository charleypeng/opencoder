// Shortcut registry core (TASK-M8-01): the pure shortcut model and the
// default table from ui-design §3.3. A Combo stores the "primary" modifier
// (⌘/Ctrl) in `ctrl` — the platform maps it at dispatch/display time: ⌘ on
// macOS, Ctrl elsewhere. Matching accepts EITHER modifier for the primary
// (a pragmatic webview choice: both ⌘ and Ctrl trigger the same action on
// every platform, which keeps the behavior uniform in tests and on mixed
// keyboards). `meta` is the explicit Super/Windows key, only meaningful on
// non-mac platforms (on macOS it is subsumed by the primary).
//
// Scopes gate dispatch: "global" shortcuts fire everywhere, "chat" only
// while the chat input is focused, "list" only while the session list is
// focused (the active scope signal lives in the shell that mounts the
// hook). `inputGuard` (default true) keeps a shortcut from firing while a
// text control is focused — plain-key shortcuts (Tab, ↑, Esc) are input
// locals owned by the composer, and a plain key must not steal text input;
// ⌘/Ctrl combos never type into the control, so they dispatch while typing
// (⌘K from the composer works). sendMessage (⌘Enter) and the server digit
// keys are documented exceptions on top (they fire even when the guard
// would apply to their plain-key shape).

export type Scope = "global" | "chat" | "list";

export interface Combo {
  /** KeyboardEvent.key, lowercased; "1..9" is the server-switch digit range. */
  key: string;
  /** The primary modifier (⌘/Ctrl). */
  ctrl: boolean;
  /** The explicit Super/Windows key (macOS: subsumed by the primary). */
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export interface Shortcut {
  id: string;
  /** User-facing label (settings UI). */
  label: string;
  scope: Scope;
  defaultCombo: Combo;
  /** Never fire while a text control is focused (default true); ⌘/Ctrl
   *  combos bypass the guard (they type nothing into the control). */
  inputGuard?: boolean;
}

export interface ShortcutConflict {
  first: string;
  second: string;
  /** The combo the two entries share. */
  combo: Combo;
}

/** Builds a primary-modifier combo (ctrl=true) with optional overrides. */
export function combo(key: string, extra: Partial<Combo> = {}): Combo {
  return { key, ctrl: true, meta: false, shift: false, alt: false, ...extra };
}

/** The full default table (ui-design §3.3). */
export const DEFAULT_SHORTCUTS: Shortcut[] = [
  {
    id: "commandPalette",
    label: "Command palette",
    scope: "global",
    defaultCombo: combo("k"),
  },
  { id: "newSession", label: "New session", scope: "global", defaultCombo: combo("n") },
  { id: "quickOpen", label: "Quick open file", scope: "global", defaultCombo: combo("p") },
  {
    id: "fullTextSearch",
    label: "Full-text search",
    scope: "global",
    defaultCombo: combo("f", { shift: true }),
  },
  {
    id: "switchServer",
    label: "Switch server",
    scope: "global",
    defaultCombo: combo("1..9"),
    // Fires while typing like the pre-registry digit hook did.
    inputGuard: false,
  },
  { id: "prevSession", label: "Previous session", scope: "global", defaultCombo: combo("[") },
  { id: "nextSession", label: "Next session", scope: "global", defaultCombo: combo("]") },
  {
    id: "sendMessage",
    label: "Send message",
    scope: "chat",
    defaultCombo: combo("enter"),
    // Fires from inside the composer, where ⌘Enter is pressed.
    inputGuard: false,
  },
  {
    id: "interrupt",
    label: "Interrupt generation / close overlay",
    scope: "global",
    defaultCombo: combo("escape", { ctrl: false }),
  },
  { id: "toggleSidebar", label: "Toggle sidebar", scope: "global", defaultCombo: combo("b") },
  { id: "toggleTerminal", label: "Toggle terminal", scope: "global", defaultCombo: combo("j") },
  { id: "sessionDiff", label: "Session diff", scope: "global", defaultCombo: combo("d") },
  { id: "openSettings", label: "Open settings", scope: "global", defaultCombo: combo(",") },
  {
    id: "tabCycle",
    label: "Cycle agent in input",
    scope: "chat",
    defaultCombo: combo("tab", { ctrl: false }),
  },
  {
    id: "lastPrompt",
    label: "Recall last prompt (empty input)",
    scope: "chat",
    defaultCombo: combo("arrowup", { ctrl: false }),
  },
];

/** Returns the registry entry for a shortcut id (undefined when unknown). */
export function shortcutById(id: string): Shortcut | undefined {
  return DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === id);
}

/** i18n resource key for a shortcut's display label (TASK-M9-02): the
 *  registry stores stable ids; the translatable copy lives in the i18n
 *  resources under settings:shortcut<Id> and renders through t(). */
export function shortcutLabelKey(id: string): string {
  return `settings:shortcut${id[0].toUpperCase()}${id.slice(1)}`;
}

/** Modifier tokens accepted by parseCombo (case-insensitive). */
const MODIFIER_TOKENS: Record<string, "ctrl" | "meta" | "shift" | "alt"> = {
  cmd: "ctrl",
  command: "ctrl",
  ctrl: "ctrl",
  control: "ctrl",
  "⌘": "ctrl",
  meta: "meta",
  win: "meta",
  super: "meta",
  shift: "shift",
  "⇧": "shift",
  alt: "alt",
  opt: "alt",
  option: "alt",
  "⌥": "alt",
};

/** Reverse key-label mapping used by parseCombo. */
const KEY_PARSE: Record<string, string> = {
  esc: "escape",
  "↑": "arrowup",
  "↓": "arrowdown",
  "←": "arrowleft",
  "→": "arrowright",
  space: " ",
  "1-9": "1..9",
};

/**
 * Parses a combo string like "Ctrl+Shift+P" or "⌘+Shift+P" (tokens joined
 * by "+", case-insensitive; "space" yields the space key). Returns null for
 * input without a key token.
 */
export function parseCombo(input: string): Combo | null {
  const tokens = input
    .split("+")
    .map((token) => token.trim())
    .filter((token) => token !== "");
  if (tokens.length === 0) return null;
  const combo: Combo = { key: "", ctrl: false, meta: false, shift: false, alt: false };
  for (const token of tokens) {
    const modifier = MODIFIER_TOKENS[token.toLowerCase()];
    if (modifier !== undefined) {
      combo[modifier] = true;
      continue;
    }
    // The first non-modifier token is the key; extra tokens are ignored.
    if (combo.key === "") {
      const raw = token.toLowerCase();
      combo.key = KEY_PARSE[raw] ?? raw;
    }
  }
  return combo.key === "" ? null : combo;
}

/** Human-friendly key label used by formatCombo. */
const KEY_LABELS: Record<string, string> = {
  " ": "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "Enter",
  escape: "Esc",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  "1..9": "1-9",
};

function keyLabel(key: string): string {
  const known = KEY_LABELS[key];
  if (known !== undefined) return known;
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Renders the combo for the platform: "⌘+Shift+P" on macOS (the primary
 *  glyph only), "Ctrl+Shift+P" elsewhere. */
export function formatCombo(value: Combo, isMac: boolean): string {
  const parts: string[] = [];
  if (value.ctrl) parts.push(isMac ? "⌘" : "Ctrl");
  if (value.shift) parts.push("Shift");
  if (value.alt) parts.push("Alt");
  if (value.meta && !isMac) parts.push("Meta");
  parts.push(keyLabel(value.key));
  return parts.join("+");
}

/** Matches the shortcut key against a keyboard key (lowercased, range-aware). */
function keyMatches(comboKey: string, eventKey: string): boolean {
  const key = eventKey.toLowerCase();
  if (comboKey === key) return true;
  if (comboKey === "1..9" && /^[1-9]$/.test(key)) return true;
  return false;
}

/** Whether two shortcut keys overlap (the "1..9" range overlaps any digit). */
export function keyOverlaps(a: string, b: string): boolean {
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  if (na === nb) return true;
  if (na === "1..9" && /^[1-9]$/.test(nb)) return true;
  if (nb === "1..9" && /^[1-9]$/.test(na)) return true;
  return false;
}

/** Whether two combos address the same keypress (modifiers + key overlap). */
export function sameCombo(a: Combo, b: Combo): boolean {
  return (
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.shift === b.shift &&
    a.alt === b.alt &&
    keyOverlaps(a.key, b.key)
  );
}

/** Whether the event carries the combo's modifiers and key (case-insensitive;
 *  the primary modifier matches either ⌘ or Ctrl). */
export function comboMatchesEvent(event: KeyboardEvent, value: Combo): boolean {
  if (!keyMatches(value.key, event.key)) return false;
  const primary = event.metaKey || event.ctrlKey;
  if (value.ctrl !== primary) return false;
  if (value.shift !== event.shiftKey) return false;
  if (value.alt !== event.altKey) return false;
  if (value.meta && !event.metaKey) return false;
  return true;
}

/**
 * Builds a combo from a captured keydown (settings capture UI): the primary
 * modifier normalizes to `ctrl` and a bare modifier key returns null.
 */
export function comboFromEvent(event: KeyboardEvent): Combo | null {
  const key = event.key;
  if (key === "" || key === "Unidentified") return null;
  if (key === "Meta" || key === "Control" || key === "Shift" || key === "Alt") return null;
  return {
    key: key.toLowerCase(),
    ctrl: event.metaKey || event.ctrlKey,
    meta: false,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

/**
 * Finds every conflicting pair among the given id→combo assignments (two
 * entries that would both fire for the same keypress). The default table
 * itself is conflict-free.
 */
export function findConflicts(assignments: Record<string, Combo>): ShortcutConflict[] {
  const ids = Object.keys(assignments);
  const conflicts: ShortcutConflict[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (sameCombo(assignments[ids[i]], assignments[ids[j]])) {
        conflicts.push({ first: ids[i], second: ids[j], combo: assignments[ids[i]] });
      }
    }
  }
  return conflicts;
}

/** Whether the event target is a text control the input guard protects. */
export function isTextControlTarget(target: EventTarget | null): boolean {
  if (target === null) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable === true || target.getAttribute("contenteditable") === "true")
  );
}
