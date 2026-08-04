// L1 tests for the shortcut registry core (TASK-M8-01): parse/format
// round trips with platform glyphs, the conflict matrix (identical,
// modifier-differing, digit-range overlaps, multi-way), key matching
// (primary = either ⌘ or Ctrl, case-insensitive, the 1..9 range), the
// capture builder (modifier-only keys ignored, ⌘ normalized to the primary
// modifier), and the guarantee that the default table is conflict-free.

import { describe, expect, it } from "vitest";
import {
  combo,
  comboFromEvent,
  comboMatchesEvent,
  DEFAULT_SHORTCUTS,
  findConflicts,
  formatCombo,
  isTextControlTarget,
  keyOverlaps,
  parseCombo,
  sameCombo,
  type Combo,
} from "./shortcuts";

function keyDown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

function defaultAssignments(): Record<string, Combo> {
  return Object.fromEntries(DEFAULT_SHORTCUTS.map((s) => [s.id, s.defaultCombo]));
}

describe("parseCombo / formatCombo", () => {
  it("parses ASCII modifier combos and formats them per platform", () => {
    const parsed = parseCombo("Ctrl+Shift+P");
    expect(parsed).toEqual(combo("p", { shift: true }));
    expect(formatCombo(parsed!, false)).toBe("Ctrl+Shift+P");
    expect(formatCombo(parsed!, true)).toBe("⌘+Shift+P");
  });

  it("parses ⌘/glyph combos and normalizes the primary modifier", () => {
    expect(parseCombo("⌘+Shift+P")).toEqual(combo("p", { shift: true }));
    expect(parseCombo("cmd+k")).toEqual(combo("k"));
    expect(parseCombo("Control+Alt+Space")).toEqual({
      key: " ",
      ctrl: true,
      meta: false,
      shift: false,
      alt: true,
    });
  });

  it("rejects modifier-only or empty input", () => {
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("Ctrl+")).toBeNull();
    expect(parseCombo("Shift")).toBeNull();
    expect(parseCombo("+")).toBeNull();
  });

  it("round-trips every default combo through format then parse", () => {
    for (const shortcut of DEFAULT_SHORTCUTS) {
      const formatted = formatCombo(shortcut.defaultCombo, false);
      const reparsed = parseCombo(formatted);
      expect(sameCombo(reparsed!, shortcut.defaultCombo)).toBe(true);
    }
  });

  it("formats the special keys (Esc/Tab/↑/Enter/1-9)", () => {
    expect(formatCombo(combo("escape", { ctrl: false }), false)).toBe("Esc");
    expect(formatCombo(combo("tab", { ctrl: false }), false)).toBe("Tab");
    expect(formatCombo(combo("arrowup", { ctrl: false }), false)).toBe("↑");
    expect(formatCombo(combo("enter"), true)).toBe("⌘+Enter");
    expect(formatCombo(combo("1..9"), true)).toBe("⌘+1-9");
    expect(formatCombo(combo(","), false)).toBe("Ctrl+,");
  });
});

describe("comboMatchesEvent", () => {
  it("matches the primary modifier with either ⌘ or Ctrl", () => {
    const comboP = combo("p");
    expect(comboMatchesEvent(keyDown({ key: "p", metaKey: true }), comboP)).toBe(true);
    expect(comboMatchesEvent(keyDown({ key: "p", ctrlKey: true }), comboP)).toBe(true);
    expect(comboMatchesEvent(keyDown({ key: "p" }), comboP)).toBe(false);
  });

  it("is case-insensitive on the key", () => {
    expect(comboMatchesEvent(keyDown({ key: "P", metaKey: true }), combo("p"))).toBe(true);
  });

  it("requires the other modifiers exactly", () => {
    const shiftF = combo("f", { shift: true });
    expect(comboMatchesEvent(keyDown({ key: "f", metaKey: true, shiftKey: true }), shiftF)).toBe(
      true,
    );
    expect(comboMatchesEvent(keyDown({ key: "f", metaKey: true }), shiftF)).toBe(false);
    const altCombo = combo("d", { alt: true });
    expect(comboMatchesEvent(keyDown({ key: "d", ctrlKey: true, altKey: true }), altCombo)).toBe(
      true,
    );
    expect(comboMatchesEvent(keyDown({ key: "d", ctrlKey: true }), altCombo)).toBe(false);
  });

  it("plain-key combos require no primary modifier", () => {
    const esc = combo("escape", { ctrl: false });
    expect(comboMatchesEvent(keyDown({ key: "Escape" }), esc)).toBe(true);
    expect(comboMatchesEvent(keyDown({ key: "Escape", metaKey: true }), esc)).toBe(false);
  });

  it("matches any digit for the 1..9 range but not 0 or letters", () => {
    const digits = combo("1..9");
    for (const digit of ["1", "3", "9"]) {
      expect(comboMatchesEvent(keyDown({ key: digit, metaKey: true }), digits)).toBe(true);
    }
    expect(comboMatchesEvent(keyDown({ key: "0", metaKey: true }), digits)).toBe(false);
    expect(comboMatchesEvent(keyDown({ key: "a", metaKey: true }), digits)).toBe(false);
  });

  it("requires the explicit meta flag when set (Super alongside the primary)", () => {
    const metaCombo: Combo = { key: "e", ctrl: true, meta: true, shift: false, alt: false };
    expect(comboMatchesEvent(keyDown({ key: "e", metaKey: true, ctrlKey: true }), metaCombo)).toBe(
      true,
    );
    expect(comboMatchesEvent(keyDown({ key: "e", ctrlKey: true }), metaCombo)).toBe(false);
  });
});

describe("comboFromEvent", () => {
  it("builds a combo and normalizes ⌘/Ctrl into the primary modifier", () => {
    expect(comboFromEvent(keyDown({ key: "P", metaKey: true, shiftKey: true }))).toEqual(
      combo("p", { shift: true }),
    );
    expect(comboFromEvent(keyDown({ key: "x", ctrlKey: true }))).toEqual(combo("x"));
  });

  it("ignores bare modifier key presses", () => {
    expect(comboFromEvent(keyDown({ key: "Meta" }))).toBeNull();
    expect(comboFromEvent(keyDown({ key: "Control" }))).toBeNull();
    expect(comboFromEvent(keyDown({ key: "Shift" }))).toBeNull();
    expect(comboFromEvent(keyDown({ key: "Alt" }))).toBeNull();
  });
});

describe("findConflicts", () => {
  it("finds pairs sharing modifiers and key", () => {
    const conflicts = findConflicts({
      a: combo("p"),
      b: combo("p"),
      c: combo("k"),
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].first).toBe("a");
    expect(conflicts[0].second).toBe("b");
  });

  it("finds digit-range overlaps", () => {
    const conflicts = findConflicts({
      digits: combo("1..9"),
      other: combo("5"),
      safe: combo("0"),
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].first).toBe("digits");
    expect(conflicts[0].second).toBe("other");
  });

  it("does not flag different keys or modifiers", () => {
    expect(findConflicts({ a: combo("p"), b: combo("k") })).toHaveLength(0);
    expect(findConflicts({ a: combo("p"), b: combo("p", { shift: true }) })).toHaveLength(0);
    expect(findConflicts({ a: combo("p"), b: combo("p", { alt: true }) })).toHaveLength(0);
  });

  it("reports every conflicting pair in a three-way tie", () => {
    const conflicts = findConflicts({
      a: combo("p"),
      b: combo("p"),
      c: combo("p"),
    });
    expect(conflicts).toHaveLength(3);
  });

  it("the default table is conflict-free", () => {
    expect(findConflicts(defaultAssignments())).toHaveLength(0);
  });
});

describe("keyOverlaps", () => {
  it("treats the 1..9 range as overlapping any digit", () => {
    expect(keyOverlaps("1..9", "5")).toBe(true);
    expect(keyOverlaps("5", "1..9")).toBe(true);
    expect(keyOverlaps("1..9", "0")).toBe(false);
    expect(keyOverlaps("1..9", "k")).toBe(false);
    expect(keyOverlaps("p", "p")).toBe(true);
    expect(keyOverlaps("p", "k")).toBe(false);
  });
});

describe("isTextControlTarget", () => {
  it("flags inputs, textareas and contenteditable targets", () => {
    expect(isTextControlTarget(document.createElement("input"))).toBe(true);
    expect(isTextControlTarget(document.createElement("textarea"))).toBe(true);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isTextControlTarget(editable)).toBe(true);
    expect(isTextControlTarget(document.createElement("button"))).toBe(false);
    expect(isTextControlTarget(window)).toBe(false);
    expect(isTextControlTarget(null)).toBe(false);
  });
});
