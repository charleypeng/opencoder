// Single-terminal component (TASK-M6-02): owns one xterm.js instance bound
// to a PTY's WebSocket data channel. Server frames arrive as ArrayBuffers
// and are UTF-8 decoded into the terminal; keystrokes are encoded and sent
// back over the channel. The terminal fits its container on resize
// (ResizeObserver) and every size change is synced to the server through
// PUT /pty/{id} — the REST resize channel (TASK-M6-01 appendix). When the
// channel closes (server-side exit or a failed connect) the pty store marks
// the pty exited and the exited note overlays the terminal; the tab stays
// mounted until the user closes it. Instances of hidden tabs stay mounted
// (the panel hides them with CSS), because a PTY dies with its WebSocket —
// unmounting a tab would make its terminal unrecoverable.

import { onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { getApiClient } from "../../services/client.js";
import { createPtyService } from "../../services/pty.js";
import { ptyConnect, ptySend } from "../../services/ptyWs.js";
import { markPtyExited } from "../../stores/ptys.js";

export interface TerminalInstanceProps {
  /** The server the PTY lives on. */
  serverId: string;
  /** The PTY id (keyed in the per-server ptys store). */
  ptyId: string;
  /** PTY status from the store ("running" | "exited"). */
  status: string;
  /** Exit code, shown in the exited note when the server reports one. */
  exitCode?: number;
  /** Called by the exited note's close button to drop the tab. */
  onClose: () => void;
}

const encoder = new TextEncoder();

/** Reads a design token, falling back to the dark-theme value when the
 *  token is missing (jsdom, or a non-theme context). */
function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/** Terminal theme mirroring the design tokens (docs/ui-design.md §2). */
function terminalTheme() {
  return {
    background: cssVar("--bg-base", "#0f1115"),
    foreground: cssVar("--fg-primary", "#e8eaf0"),
    cursor: cssVar("--accent", "#7c8cff"),
    cursorAccent: cssVar("--bg-base", "#0f1115"),
  };
}

const TerminalInstance: Component<TerminalInstanceProps> = (props) => {
  // Captured once: an instance is keyed by its pty and remounts (never
  // re-props) when either changes, so the mount-time callbacks below can
  // read these safely outside a tracked scope.
  // eslint-disable-next-line solid/reactivity -- one-time capture, keyed remounts
  const serverId = props.serverId;
  // eslint-disable-next-line solid/reactivity -- one-time capture, keyed remounts
  const ptyId = props.ptyId;
  let container: HTMLDivElement | undefined;
  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
  let connection: { connectionId: number; close: () => Promise<void> } | undefined;
  let observer: ResizeObserver | undefined;
  // Set in the dispose path: guards the frame/keystroke/resize handlers
  // against running after the terminal is gone. connection.close() is async,
  // so frames can land between the close() call and the Rust-side
  // termination — without this flag they would write into a disposed
  // terminal.
  let disposed = false;

  /** Fits only while the container is actually visible: fitting a hidden
   *  tab would resize its PTY to 1 row × 2 cols and PUT that to the server. */
  function fitIfVisible(): void {
    if (!container || !fit) return;
    if (container.offsetWidth === 0 && container.offsetHeight === 0) return;
    fit.fit();
  }

  onMount(() => {
    // Streaming decoder, one per mounted instance: PTY frames may split a
    // UTF-8 sequence across WebSocket messages, and only stream-mode decode
    // buffers an incomplete trailing byte until the next frame. It must not
    // live at module level — concurrent tabs would interleave partial
    // sequences.
    const streamDecoder = new TextDecoder();
    const terminal = new Terminal({
      fontSize: 13,
      fontFamily: cssVar("--font-code", "ui-monospace, SFMono-Regular, Menlo, monospace"),
      cursorBlink: true,
      theme: terminalTheme(),
    });
    term = terminal;
    const fitAddon = new FitAddon();
    fit = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.open(container as HTMLDivElement);
    fitIfVisible();

    // Terminal size changes (fit included) sync through the REST resize
    // channel — the contract routes resize over PUT, not WebSocket frames.
    terminal.onResize(({ cols, rows }) => {
      if (disposed) return;
      void createPtyService(getApiClient()).update(ptyId, { size: { rows, cols } });
    });

    terminal.onData((data) => {
      if (disposed) return;
      const current = connection;
      if (current) void ptySend(current.connectionId, encoder.encode(data));
    });

    // Re-fit whenever the container's size changes (window resizes, panel
    // splits, a hidden tab becoming visible).
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => fitIfVisible());
      observer.observe(container as HTMLDivElement);
    }

    // Exited ptys need no channel; the note renders instead.
    if (props.status === "exited") return;
    void ptyConnect(serverId, ptyId, {
      onData: (bytes) => {
        if (disposed) return;
        terminal.write(streamDecoder.decode(bytes, { stream: true }));
      },
      onClose: () => markPtyExited(serverId, ptyId),
    })
      .then((conn) => {
        connection = conn;
      })
      .catch(() => {
        // A dead channel means no output will ever arrive: surface the
        // exited state instead of a blank terminal.
        markPtyExited(serverId, ptyId);
      });
  });

  onCleanup(() => {
    disposed = true;
    observer?.disconnect();
    observer = undefined;
    const current = connection;
    connection = undefined;
    if (current) void current.close();
    term?.dispose();
    term = undefined;
    fit = undefined;
  });

  return (
    <div class="relative h-full min-h-0">
      <div ref={container} data-testid="terminal-container" class="h-full w-full" />
      <Show when={props.status === "exited"}>
        <div
          data-testid="terminal-exited"
          class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-bg-base/80"
        >
          <p class="text-sm text-fg-secondary">
            Process exited{props.exitCode !== undefined ? ` (code ${props.exitCode})` : ""}
          </p>
          <button
            type="button"
            data-testid="terminal-exited-close"
            class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
            onClick={() => props.onClose()}
          >
            Close
          </button>
        </div>
      </Show>
    </div>
  );
};

export default TerminalInstance;
