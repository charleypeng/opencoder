// Terminal panel (TASK-M6-02): the multi-tab PTY terminal. Tabs mirror the
// per-server ptys store (fed by pty.created/updated/exited/deleted SSE
// events and by this panel's own creates); each tab renders a
// TerminalInstance that owns its WebSocket channel. The "+" button opens a
// small shell picker (GET /pty/shells); picking a shell POSTs /pty and
// opens the new terminal as the active tab. All tabs stay mounted — hidden
// tabs are display:none only — because a PTY dies with its WebSocket, so
// switching tabs must never tear a channel down. Exited tabs keep their
// note until the user closes them (removal also DELETEs the server-side
// pty and unmounting the tab closes its channel).

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { getApiClient } from "../../services/client.js";
import { createPtyService, type PtyShell } from "../../services/pty.js";
import { getServerPtyState, removePty, upsertPty } from "../../stores/ptys.js";
import TerminalInstance from "./TerminalInstance.js";

export interface TerminalPanelProps {
  /** The server whose terminals are shown. */
  serverId: string;
}

const TerminalPanel: Component<TerminalPanelProps> = (props) => {
  const ptyService = createPtyService(getApiClient());
  // Reactive per-server bucket: tab order + entries track the store
  // (SessionList pattern).
  const state = createMemo(() => getServerPtyState(props.serverId));

  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [shells, setShells] = createSignal<PtyShell[] | null>(null);
  const [shellsError, setShellsError] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [createError, setCreateError] = createSignal(false);

  // Active tab: the recorded choice while it still exists in the store,
  // otherwise the first tab (covers closing the active tab and server
  // switches, whose ptys bucket resets to empty).
  const activeTabId = createMemo(() => {
    const id = activeId();
    if (id !== null && state().ptys[id] !== undefined) return id;
    return state().order[0] ?? null;
  });

  function togglePicker(): void {
    const opening = !pickerOpen();
    setPickerOpen(opening);
    if (!opening || shells() !== null) return;
    setShellsError(false);
    void ptyService
      .shells()
      .then((list) => setShells(list))
      .catch(() => setShellsError(true));
  }

  /** Creates a pty (a picked shell or the server's default) and opens it. */
  async function createTerminal(shell?: PtyShell): Promise<void> {
    if (creating()) return;
    setCreating(true);
    setCreateError(false);
    try {
      const pty = await ptyService.create(
        shell === undefined ? {} : { command: shell.path, title: shell.name },
      );
      upsertPty(props.serverId, pty);
      setActiveId(pty.id);
      setPickerOpen(false);
    } catch {
      setCreateError(true);
    } finally {
      setCreating(false);
    }
  }

  /** Drops a tab: DELETEs the server-side pty (kills the process) and
   *  removes it from the store — the unmount closes the tab's channel. */
  function closeTab(ptyId: string): void {
    void ptyService.remove(ptyId).catch(() => {
      // The pty.deleted SSE event heals the store if the DELETE lands.
    });
    removePty(props.serverId, ptyId);
  }

  // Esc closes the shell picker (the todos-drawer pattern).
  createEffect(() => {
    if (!pickerOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <div data-testid="terminal-panel" class="relative flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Terminals"
        class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-bg-sunken px-2 py-1.5"
      >
        <For each={state().order}>
          {(ptyId) => {
            const pty = () => state().ptys[ptyId];
            const active = () => activeTabId() === ptyId;
            const title = () => pty().title || pty().command;
            return (
              <div
                class={`flex shrink-0 items-center rounded-md border ${
                  active()
                    ? "border-accent bg-accent-soft"
                    : "border-transparent text-fg-secondary hover:text-fg-primary"
                } ${pty().status === "exited" ? "opacity-60" : ""}`}
              >
                <button
                  type="button"
                  role="tab"
                  data-testid={`terminal-tab-${ptyId}`}
                  aria-selected={active() ? "true" : "false"}
                  title={title()}
                  class="max-w-48 truncate px-2.5 py-1 text-xs outline-none"
                  onClick={() => setActiveId(ptyId)}
                >
                  {title()}
                </button>
                <button
                  type="button"
                  data-testid={`terminal-tab-close-${ptyId}`}
                  aria-label={`Close ${title()}`}
                  class="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-xs text-fg-faint hover:bg-bg-sunken hover:text-fg-primary"
                  onClick={() => closeTab(ptyId)}
                >
                  ×
                </button>
              </div>
            );
          }}
        </For>
        <button
          type="button"
          data-testid="terminal-new"
          aria-label="New terminal"
          title="New terminal"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-secondary outline-none hover:bg-bg-sunken hover:text-fg-primary"
          onClick={togglePicker}
        >
          +
        </button>
      </div>

      <Show
        when={activeTabId() !== null}
        fallback={
          <div
            data-testid="terminal-empty"
            class="flex flex-1 flex-col items-center justify-center gap-1 p-4"
          >
            <p class="text-sm text-fg-secondary">No terminal open</p>
            <p class="text-xs text-fg-faint">Press + to start a shell.</p>
          </div>
        }
      >
        <div class="min-h-0 flex-1">
          <For each={state().order}>
            {(ptyId) => {
              const pty = () => state().ptys[ptyId];
              const active = () => activeTabId() === ptyId;
              return (
                <div
                  data-testid={`terminal-instance-${ptyId}`}
                  data-active={active() ? "true" : "false"}
                  class={active() ? "h-full" : "hidden"}
                >
                  <TerminalInstance
                    serverId={props.serverId}
                    ptyId={ptyId}
                    status={pty().status}
                    exitCode={pty().exitCode}
                    onClose={() => closeTab(ptyId)}
                  />
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Shell picker: rendered under the tab bar (not inside the
          overflow-x-auto tablist, which would clip it). */}
      <Show when={pickerOpen()}>
        <div
          data-testid="terminal-shell-picker"
          class="absolute left-2 top-9 z-30 w-56 rounded-md border border-bg-sunken bg-bg-elevated p-1 shadow-lg"
        >
          <button
            type="button"
            data-testid="terminal-shell-default"
            class="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-fg-secondary outline-none hover:bg-bg-sunken hover:text-fg-primary"
            onClick={() => void createTerminal()}
          >
            Default shell
          </button>
          <Show
            when={shells() !== null}
            fallback={
              shellsError() ? (
                <div class="px-2 py-1.5">
                  <p data-testid="terminal-shells-error" class="text-xs text-fg-secondary">
                    Unable to load shells.
                  </p>
                  <button
                    type="button"
                    data-testid="terminal-shells-retry"
                    class="mt-1 rounded-md border border-bg-sunken bg-bg-sunken px-2 py-0.5 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
                    onClick={() => {
                      setShellsError(false);
                      void ptyService
                        .shells()
                        .then((list) => setShells(list))
                        .catch(() => setShellsError(true));
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <p data-testid="terminal-shells-loading" class="px-2 py-1.5 text-xs text-fg-faint">
                  Loading shells…
                </p>
              )
            }
          >
            <For each={shells()}>
              {(shell) => (
                <button
                  type="button"
                  data-testid={`terminal-shell-${shell.name}`}
                  class="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-fg-secondary outline-none hover:bg-bg-sunken hover:text-fg-primary"
                  onClick={() => void createTerminal(shell)}
                >
                  {shell.name}
                  <Show when={!shell.acceptable}>
                    <span class="text-fg-faint"> (unsupported)</span>
                  </Show>
                </button>
              )}
            </For>
          </Show>
          <Show when={createError()}>
            <p data-testid="terminal-create-error" class="px-2 py-1.5 text-xs text-danger">
              Failed to create terminal.
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default TerminalPanel;
