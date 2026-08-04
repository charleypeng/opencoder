// L2 tests for the shortcuts settings section (TASK-M8-01): the full
// default table renders with platform-formatted combos; clicking a combo
// captures the next key combination (Esc cancels, bare modifiers ignored,
// captured keys never reach a sibling dispatcher); a conflicting capture is
// rejected with an inline warning naming the conflicting shortcut; per-row
// and reset-all restore the defaults; customizations persist.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import ShortcutsSection from "./ShortcutsSection";
import { effectiveCombo, resetAllShortcuts, saveShortcutCombo } from "./shortcutStore";
import { combo } from "./shortcuts";

beforeEach(() => {
  resetAllShortcuts();
});

afterEach(() => {
  resetAllShortcuts();
});

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

describe("ShortcutsSection", () => {
  it("renders every default shortcut with its formatted combo", () => {
    render(() => <ShortcutsSection />);

    expect(screen.getByTestId("shortcut-row-quickOpen")).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-label-quickOpen")).toHaveTextContent("Quick open file");
    expect(screen.getByTestId("shortcut-combo-quickOpen")).toHaveTextContent("Ctrl+P");
    expect(screen.getByTestId("shortcut-combo-fullTextSearch")).toHaveTextContent("Ctrl+Shift+F");
    expect(screen.getByTestId("shortcut-combo-switchServer")).toHaveTextContent("Ctrl+1-9");
    expect(screen.getByTestId("shortcut-combo-interrupt")).toHaveTextContent("Esc");
    expect(screen.getByTestId("shortcut-combo-tabCycle")).toHaveTextContent("Tab");
    expect(screen.getByTestId("shortcut-combo-lastPrompt")).toHaveTextContent("↑");
    expect(screen.getByTestId("shortcut-combo-sendMessage")).toHaveTextContent("Ctrl+Enter");
    expect(screen.getByTestId("shortcut-combo-openSettings")).toHaveTextContent("Ctrl+,");
  });

  it("captures a new combo on click and persists it", () => {
    render(() => <ShortcutsSection />);

    fireEvent.click(screen.getByTestId("shortcut-combo-quickOpen"));
    expect(screen.getByTestId("shortcut-capture-hint")).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-combo-quickOpen")).toHaveTextContent("Press keys…");

    press({ key: "e", metaKey: true });
    expect(effectiveCombo("quickOpen")).toEqual(combo("e"));
    expect(screen.getByTestId("shortcut-combo-quickOpen")).toHaveTextContent("Ctrl+E");
    // The row gains its per-row reset button.
    expect(screen.getByTestId("shortcut-reset-quickOpen")).toBeInTheDocument();
    expect(screen.queryByTestId("shortcut-capture-hint")).not.toBeInTheDocument();
  });

  it("ignores bare modifier presses while capturing and cancels on Esc", () => {
    render(() => <ShortcutsSection />);
    fireEvent.click(screen.getByTestId("shortcut-combo-quickOpen"));

    press({ key: "Meta" });
    expect(effectiveCombo("quickOpen")).toEqual(combo("p"));

    press({ key: "Escape" });
    expect(screen.queryByTestId("shortcut-capture-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("shortcut-combo-quickOpen")).toHaveTextContent("Ctrl+P");
  });

  it("rejects a combo already used by another shortcut and names it", () => {
    render(() => <ShortcutsSection />);

    fireEvent.click(screen.getByTestId("shortcut-combo-quickOpen"));
    press({ key: "k", metaKey: true });

    const warning = screen.getByTestId("shortcut-conflict-warning");
    expect(warning).toHaveTextContent("Ctrl+K");
    expect(warning).toHaveTextContent("Command palette");
    // The rejected combo was NOT saved.
    expect(effectiveCombo("quickOpen")).toEqual(combo("p"));
    expect(screen.queryByTestId("shortcut-reset-quickOpen")).not.toBeInTheDocument();
  });

  it("rejects a digit combo conflicting with the switch-server range", () => {
    render(() => <ShortcutsSection />);

    fireEvent.click(screen.getByTestId("shortcut-combo-quickOpen"));
    press({ key: "5", metaKey: true });

    const warning = screen.getByTestId("shortcut-conflict-warning");
    expect(warning).toHaveTextContent("Switch server");
    expect(effectiveCombo("quickOpen")).toEqual(combo("p"));
  });

  it("per-row reset restores the default combo", () => {
    saveShortcutCombo("quickOpen", combo("e"));
    render(() => <ShortcutsSection />);
    expect(screen.getByTestId("shortcut-combo-quickOpen")).toHaveTextContent("Ctrl+E");

    fireEvent.click(screen.getByTestId("shortcut-reset-quickOpen"));
    expect(effectiveCombo("quickOpen")).toEqual(combo("p"));
    expect(screen.getByTestId("shortcut-combo-quickOpen")).toHaveTextContent("Ctrl+P");
    expect(screen.queryByTestId("shortcut-reset-quickOpen")).not.toBeInTheDocument();
  });

  it("reset all clears every customization", () => {
    saveShortcutCombo("quickOpen", combo("e"));
    saveShortcutCombo("newSession", combo("m"));
    render(() => <ShortcutsSection />);
    expect(screen.getByTestId("shortcut-combo-quickOpen")).toHaveTextContent("Ctrl+E");
    expect(screen.getByTestId("shortcut-combo-newSession")).toHaveTextContent("Ctrl+M");

    fireEvent.click(screen.getByTestId("shortcut-reset-all"));
    expect(effectiveCombo("quickOpen")).toEqual(combo("p"));
    expect(effectiveCombo("newSession")).toEqual(combo("n"));
    expect(screen.getByTestId("shortcut-combo-quickOpen")).toHaveTextContent("Ctrl+P");
  });

  it("shows a customized combo already stored at mount", () => {
    saveShortcutCombo("toggleTerminal", combo("t"));
    render(() => <ShortcutsSection />);
    expect(screen.getByTestId("shortcut-combo-toggleTerminal")).toHaveTextContent("Ctrl+T");
    expect(screen.getByTestId("shortcut-reset-toggleTerminal")).toBeInTheDocument();
  });

  it("captured keys are stopped before reaching the window bubble listeners", () => {
    // A sibling window bubble listener must never see a captured key.
    const sibling = vi.fn();
    window.addEventListener("keydown", sibling);
    render(() => <ShortcutsSection />);
    fireEvent.click(screen.getByTestId("shortcut-combo-quickOpen"));
    press({ key: "p", metaKey: true });
    window.removeEventListener("keydown", sibling);

    expect(sibling).not.toHaveBeenCalled();
    expect(effectiveCombo("quickOpen")).toEqual(combo("p"));
  });
});
