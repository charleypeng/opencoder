// L2 tests for the mobile terminal aux key strip (TASK-M7-09): the plain
// keys send the xterm/readline sequences (Esc = \x1b, Tab = \t, arrows =
// CSI codes, pipe = literal), the Ctrl toggle reveals the one-shot control
// letters, and pressing one sends the ASCII control byte and exits the
// mode (a second press needs the toggle again).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import TerminalKeyStrip from "./TerminalKeyStrip";

function mountStrip() {
  const onKey = vi.fn();
  render(() => <TerminalKeyStrip onKey={onKey} />);
  return onKey;
}

describe("TerminalKeyStrip", () => {
  it("sends the plain key sequences", () => {
    const onKey = mountStrip();

    fireEvent.click(screen.getByTestId("key-esc"));
    fireEvent.click(screen.getByTestId("key-tab"));
    fireEvent.click(screen.getByTestId("key-pipe"));
    expect(onKey.mock.calls.map((call) => call[0])).toEqual(["\x1b", "\t", "|"]);

    fireEvent.click(screen.getByTestId("key-up"));
    fireEvent.click(screen.getByTestId("key-down"));
    fireEvent.click(screen.getByTestId("key-left"));
    fireEvent.click(screen.getByTestId("key-right"));
    expect(onKey.mock.calls.slice(3).map((call) => call[0])).toEqual([
      "\x1b[A",
      "\x1b[B",
      "\x1b[D",
      "\x1b[C",
    ]);
  });

  it("Ctrl toggles a one-shot letter row that sends control bytes", () => {
    const onKey = mountStrip();
    expect(screen.queryByTestId("key-ctrl-letters")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("key-ctrl"));
    expect(screen.getByTestId("key-ctrl")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("key-ctrl-letters")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("key-ctrl-c"));
    expect(onKey).toHaveBeenLastCalledWith("\x03");

    // One-shot: the letter row hides again after the press.
    expect(screen.queryByTestId("key-ctrl-letters")).not.toBeInTheDocument();
    expect(screen.getByTestId("key-ctrl")).toHaveAttribute("aria-pressed", "false");
  });

  it("sends the right byte for every control letter", () => {
    const onKey = mountStrip();

    const letters: Array<[string, string]> = [
      ["a", "\x01"],
      ["c", "\x03"],
      ["d", "\x04"],
      ["e", "\x05"],
      ["k", "\x0b"],
      ["u", "\x15"],
      ["w", "\x17"],
      ["z", "\x1a"],
    ];
    for (const [label, expected] of letters) {
      // Each iteration toggles Ctrl on (the previous letter press exits it).
      fireEvent.click(screen.getByTestId("key-ctrl"));
      fireEvent.click(screen.getByTestId(`key-ctrl-${label}`));
      expect(onKey).toHaveBeenLastCalledWith(expected);
    }
  });

  it("Ctrl can be toggled off again without sending anything", () => {
    const onKey = mountStrip();
    fireEvent.click(screen.getByTestId("key-ctrl"));
    fireEvent.click(screen.getByTestId("key-ctrl"));
    expect(screen.queryByTestId("key-ctrl-letters")).not.toBeInTheDocument();
    expect(onKey).not.toHaveBeenCalled();
  });
});
