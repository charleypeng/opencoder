// Mobile terminal aux key strip (TASK-M7-09): a screen-keyboard row of the
// keys a shell needs but a mobile keyboard hides — Esc, Tab, the arrow
// keys, the pipe and a sticky Ctrl mode. The Ctrl toggle swaps the strip
// to a row of control letters (the ones you actually need on a phone:
// Ctrl+C interrupt, Ctrl+D EOF, Ctrl+Z suspend, plus the bash line-editing
// A/E/U/K/W); pressing a letter sends the control character and exits the
// mode (one-shot, documented simplification — a full Ctrl prefix toggle
// for arbitrary letters would need to intercept the OS keyboard).
//
// Sequences are the xterm/readline conventions: Esc = \x1b, Tab = \t,
// arrows = the ESC [ A/B/C/D CSI codes, Ctrl-letter = the ASCII control
// byte. The strip is presentation-only: it calls `onKey` with the raw
// sequence and the terminal page routes it into the active instance's
// input channel.

import { createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";

export interface TerminalKeyStripProps {
  /** Sends one raw key sequence to the active terminal. */
  onKey: (data: string) => void;
}

const ARROWS = [
  { label: "↑", data: "\x1b[A", testId: "key-up" },
  { label: "↓", data: "\x1b[B", testId: "key-down" },
  { label: "←", data: "\x1b[D", testId: "key-left" },
  { label: "→", data: "\x1b[C", testId: "key-right" },
];

/** Control letters shown in Ctrl mode: byte value of the control char. */
const CONTROL_LETTERS = [
  { label: "A", byte: 0x01 }, // line start
  { label: "C", byte: 0x03 }, // interrupt
  { label: "D", byte: 0x04 }, // EOF
  { label: "E", byte: 0x05 }, // line end
  { label: "K", byte: 0x0b }, // kill to end
  { label: "U", byte: 0x15 }, // kill line
  { label: "W", byte: 0x17 }, // kill word
  { label: "Z", byte: 0x1a }, // suspend
];

const keyClass =
  "flex h-11 min-w-11 flex-1 items-center justify-center rounded-md border border-bg-sunken " +
  "bg-bg-elevated px-2 text-sm text-fg-secondary outline-none active:bg-accent-soft";

const TerminalKeyStrip: Component<TerminalKeyStripProps> = (props) => {
  const [ctrlMode, setCtrlMode] = createSignal(false);

  return (
    <div
      data-testid="terminal-key-strip"
      class="shrink-0 space-y-1 border-t border-bg-sunken bg-bg-base px-2 pb-safe pt-1"
    >
      <div class="flex gap-1">
        <button
          type="button"
          data-testid="key-esc"
          class={keyClass}
          onClick={() => props.onKey("\x1b")}
        >
          Esc
        </button>
        <button
          type="button"
          data-testid="key-tab"
          class={keyClass}
          onClick={() => props.onKey("\t")}
        >
          Tab
        </button>
        <button
          type="button"
          data-testid="key-pipe"
          class={keyClass}
          onClick={() => props.onKey("|")}
        >
          |
        </button>
        <button
          type="button"
          data-testid="key-ctrl"
          data-active={ctrlMode() ? "true" : "false"}
          aria-pressed={ctrlMode() ? "true" : "false"}
          class={`${keyClass} ${ctrlMode() ? "border-accent bg-accent-soft text-fg-primary" : ""}`}
          onClick={() => setCtrlMode((value) => !value)}
        >
          Ctrl
        </button>
      </div>
      <div class="flex gap-1">
        <For each={ARROWS}>
          {(key) => (
            <button
              type="button"
              data-testid={key.testId}
              aria-label={key.label}
              class={keyClass}
              onClick={() => props.onKey(key.data)}
            >
              {key.label}
            </button>
          )}
        </For>
      </div>
      {/* Ctrl mode: one-shot control letters; pressing one sends the byte
          and exits the mode. */}
      <Show when={ctrlMode()}>
        <div data-testid="key-ctrl-letters" class="flex gap-1">
          <For each={CONTROL_LETTERS}>
            {(key) => (
              <button
                type="button"
                data-testid={`key-ctrl-${key.label.toLowerCase()}`}
                class={keyClass}
                onClick={() => {
                  props.onKey(String.fromCharCode(key.byte));
                  setCtrlMode(false);
                }}
              >
                {key.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default TerminalKeyStrip;
