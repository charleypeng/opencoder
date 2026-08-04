// Command palette (⌘/Ctrl+K) dialog (TASK-M8-02): a kobalte modal
// aggregating the six searchable sources — sessions (the per-server
// session store, filtered locally by title/slug), files and symbols (the
// /find/file + /find/symbol sources shared with QuickOpen, behind the
// same 150ms debounce + stale-drop guard; a `#`-prefixed query searches
// symbols instead of files), commands (GET /command, fetched once per
// component instance and run through POST /session/{id}/command — the
// same channel as the composer's slash menu), settings actions (new
// session / settings / sidebar / terminal / diff; the M9-03 theme toggle
// is not wired yet) and servers (the registry list, switching the active
// server like a rail click). Results render in fixed section order with
// per-kind icons; empty sections are hidden. The flat row list drives
// ↑↓-wrap navigation across section boundaries; Enter or a click
// executes the selected row through the DesktopShell-provided actions
// and closes the palette; Esc closes without executing. File/symbol
// picks replicate QuickOpen's side effects (viewer tab + active line +
// per-server recent memory) before handing the view switch back to the
// shell.

import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { getApiClient } from "../../services/client.js";
import { createFindService } from "../../services/find.js";
import { createCommandService, type Command } from "../../services/command.js";
import type { ServerEntry } from "../../services/servers.js";
import { getServerSessionState } from "../../stores/session.js";
import { getActiveDirectory } from "../../stores/project.js";
import { openTab, setActiveLine } from "../../stores/viewer.js";
import { pushRecentFile, readRecentFiles } from "../../features/files/recentFiles.js";
import { rankResults, type RankedEntry } from "../../features/files/rankResults.js";
import {
  isSymbolQuery,
  symbolHitOf,
  symbolKindIcon,
  symbolQueryOf,
  type SymbolHit,
} from "../../features/files/symbols.js";
import { buildPaletteItems, type PaletteGroup, type PaletteItem } from "./paletteItems.js";

export interface CommandPaletteActions {
  /** Creates a session (the same handler as the ⌘N shortcut). */
  onNewSession: () => void;
  /** Opens the settings view. */
  onOpenSettings: () => void;
  /** Collapses/restores the sidebar (the same handler as ⌘B). */
  onToggleSidebar: () => void;
  /** Opens the terminal view. */
  onOpenTerminal: () => void;
  /** Opens the diff view for the active session. */
  onOpenDiff: () => void;
  /** Switches the active server (the same handler as a rail click). */
  onSwitchServer: (serverId: string) => void;
  /** Opens a session (the same handler as a session row click). */
  onOpenSession: (sessionId: string) => void;
  /** Runs a slash command in the active session. */
  onRunCommand: (name: string) => void;
  /** Called after a file was opened (the shell switches Main to Files). */
  onOpenFile: (path: string) => void;
  /** Called after a symbol was opened (the shell switches Main to Files). */
  onOpenSymbol: (path: string, line: number) => void;
}

export interface CommandPaletteProps {
  /** The server whose workspace and sessions are searched. */
  serverId: string;
  /** The server registry rows behind the Servers section. */
  servers: ServerEntry[];
  /** Controlled visibility (DesktopShell's ⌘/Ctrl+K state). */
  open: boolean;
  /** Whether a session is open — gates the Commands section + the diff
   *  action (slash commands and diffs need a session to run against). */
  hasActiveSession: boolean;
  /** Pre-wired shell actions (DesktopShell owns the state transitions). */
  actions: CommandPaletteActions;
  /** Called when the palette is dismissed (Esc / overlay / after a pick). */
  onClose: () => void;
}

const SEARCH_DEBOUNCE_MS = 150;

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4 shrink-0 text-fg-faint"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function EmptyRow(props: { testId: string; label: string }) {
  return (
    <div data-testid={props.testId} class="px-4 py-2.5 text-xs text-fg-faint">
      {props.label}
    </div>
  );
}

/** Per-kind icon: an inline SVG for the structural kinds and the LSP kind
 *  glyph (reused from QuickOpen) for symbol rows. */
function KindGlyph(props: { kind: PaletteItem["kind"]; symbolKind?: number }) {
  const path = createMemo(() => {
    switch (props.kind) {
      case "session":
        return <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
      case "file":
        return (
          <>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </>
        );
      case "command":
        return <path d="m4 7 5 5-5 5M12 17h8" />;
      case "setting":
        return (
          <>
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </>
        );
      case "server":
        return (
          <>
            <rect x="3" y="4" width="18" height="7" rx="1.5" />
            <rect x="3" y="13" width="18" height="7" rx="1.5" />
          </>
        );
    }
  });
  return (
    <span aria-hidden="true" class="w-4 shrink-0 text-fg-faint">
      <Show
        when={props.kind === "symbol"}
        fallback={
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
          >
            {path()}
          </svg>
        }
      >
        <span class="w-4 text-center font-code text-xs">
          {symbolKindIcon(props.symbolKind ?? 0)}
        </span>
      </Show>
    </span>
  );
}

/** One palette row: the per-kind icon, the primary title and the detail
 *  (path / description / hint / url). */
function RowView(props: {
  item: PaletteItem;
  selected: boolean;
  onExecute: (item: PaletteItem) => void;
}) {
  const view = createMemo(() => {
    const item = props.item;
    switch (item.kind) {
      case "session":
        return { title: item.title, detail: "" };
      case "file":
        return { title: item.path, detail: "" };
      case "symbol":
        return { title: item.name, detail: item.path };
      case "command":
        return { title: `/${item.name}`, detail: item.description };
      case "setting":
        return { title: item.label, detail: item.hint };
      case "server":
        return { title: item.name, detail: item.url };
    }
  });
  return (
    <button
      type="button"
      role="option"
      data-testid={`command-palette-item-${props.item.kind}-${props.item.key}`}
      aria-selected={props.selected ? "true" : "false"}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => props.onExecute(props.item)}
      class={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm outline-none ${
        props.selected ? "bg-bg-sunken" : ""
      }`}
    >
      <KindGlyph
        kind={props.item.kind}
        symbolKind={props.item.kind === "symbol" ? props.item.symbolKind : undefined}
      />
      <span class="truncate font-code text-xs text-fg-default">{view().title}</span>
      <span class="truncate text-xs text-fg-faint">{view().detail}</span>
    </button>
  );
}

const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const [query, setQuery] = createSignal("");
  const [files, setFiles] = createSignal<RankedEntry[]>([]);
  const [symbols, setSymbols] = createSignal<SymbolHit[]>([]);
  const [commands, setCommands] = createSignal<Command[] | null>(null);
  const [selected, setSelected] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  // Debounce timer + request sequence: the sequence invalidates in-flight
  // responses so a stale reply never lands (QuickOpen pattern).
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fetchSeq = 0;
  // The command catalog is fetched once per component instance and reused
  // across opens; a failed fetch is retried on the next open.
  let commandsFetching = false;
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  async function fetchCommandsIfNeeded(): Promise<void> {
    if (commands() !== null || commandsFetching || !props.hasActiveSession) return;
    commandsFetching = true;
    try {
      setCommands(await createCommandService(getApiClient()).list());
    } catch {
      // Unreachable catalog: the Commands section stays hidden until the
      // next open retries the fetch.
    } finally {
      commandsFetching = false;
    }
  }

  // Opening the palette resets to the empty-query overview and warms the
  // command catalog; closing drops any pending debounce + in-flight work.
  createEffect(() => {
    if (!props.open) {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      fetchSeq += 1;
      return;
    }
    setQuery("");
    setFiles([]);
    setSymbols([]);
    setSelected(0);
    setLoading(false);
    // The catalog guard reads signals (commands()); untrack keeps the
    // fetch from re-running this effect when the catalog lands.
    untrack(() => void fetchCommandsIfNeeded());
  });

  // Pending timers never survive unmount.
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
    fetchSeq += 1;
  });

  const queryText = createMemo(() => query().trim());
  const groups = createMemo<PaletteGroup[]>(() => {
    const state = getServerSessionState(props.serverId);
    return buildPaletteItems({
      query: queryText(),
      sessions: state.order.map((id) => state.sessions[id]),
      files: files(),
      symbols: symbols(),
      commands: commands() ?? [],
      servers: props.servers,
      hasActiveSession: props.hasActiveSession,
    });
  });
  // Each group carries the offset of its first row in the flat list, so
  // keyboard selection works across section boundaries.
  const groupsWithOffsets = createMemo(() => {
    let offset = 0;
    return groups().map((group) => {
      const next = { ...group, offset };
      offset += group.items.length;
      return next;
    });
  });
  const flat = createMemo<PaletteItem[]>(() => groups().flatMap((group) => group.items));
  // The selected row clamped to the visible list: local filtering can
  // shrink the list while the selection still points past its end.
  const selectedIndex = createMemo(() => {
    const count = flat().length;
    return count === 0 ? 0 : Math.min(selected(), count - 1);
  });
  // "Searching…" only while a remote fetch owns the whole result list.
  const showLoading = createMemo(() => loading() && queryText() !== "" && flat().length === 0);

  async function search(value: string): Promise<void> {
    const seq = ++fetchSeq;
    setLoading(true);
    try {
      const find = createFindService(getApiClient());
      if (isSymbolQuery(value)) {
        const items = await find.symbols(symbolQueryOf(value));
        if (seq !== fetchSeq) return; // stale response; a newer query owns the list
        setSymbols(items.map((symbol) => symbolHitOf(symbol, getActiveDirectory())));
      } else {
        const items = await find.files(value);
        if (seq !== fetchSeq) return; // stale response; a newer query owns the list
        setFiles(rankResults(value, items, readRecentFiles(props.serverId)));
      }
      setSelected(0);
      // New result set: jump the list back to the top.
      if (listRef) listRef.scrollTop = 0;
    } catch {
      if (seq !== fetchSeq) return;
      // A failed search leaves the remote sections empty; typing again
      // re-searches.
      setFiles([]);
      setSymbols([]);
    } finally {
      if (seq === fetchSeq) setLoading(false);
    }
  }

  function onInput(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value;
    setQuery(value);
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (value.trim() === "") {
      // Back to the overview: cancel any in-flight search.
      fetchSeq += 1;
      setLoading(false);
      setFiles([]);
      setSymbols([]);
      setSelected(0);
      return;
    }
    setFiles([]);
    setSymbols([]);
    setSelected(0);
    // Show "Searching…" while the debounce window and fetch run, instead
    // of a stale "No matches" from the cleared list.
    setLoading(true);
    timer = setTimeout(() => {
      timer = undefined;
      void search(value.trim());
    }, SEARCH_DEBOUNCE_MS);
  }

  function openFile(path: string): void {
    openTab(props.serverId, path);
    pushRecentFile(props.serverId, path);
    props.actions.onOpenFile(path);
    props.onClose();
  }

  function openSymbol(item: Extract<PaletteItem, { kind: "symbol" }>): void {
    openTab(props.serverId, item.path);
    setActiveLine(props.serverId, item.path, item.line);
    pushRecentFile(props.serverId, item.path);
    props.actions.onOpenSymbol(item.path, item.line);
    props.onClose();
  }

  function runSetting(settingId: string): void {
    switch (settingId) {
      case "new-session":
        props.actions.onNewSession();
        break;
      case "open-settings":
        props.actions.onOpenSettings();
        break;
      case "toggle-sidebar":
        props.actions.onToggleSidebar();
        break;
      case "open-terminal":
        props.actions.onOpenTerminal();
        break;
      case "open-diff":
        props.actions.onOpenDiff();
        break;
    }
  }

  function execute(item: PaletteItem): void {
    switch (item.kind) {
      case "session":
        props.actions.onOpenSession(item.sessionId);
        break;
      case "file":
        openFile(item.path);
        return; // openFile closes the palette
      case "symbol":
        openSymbol(item);
        return; // openSymbol closes the palette
      case "command":
        props.actions.onRunCommand(item.name);
        break;
      case "setting":
        runSetting(item.settingId);
        break;
      case "server":
        props.actions.onSwitchServer(item.serverId);
        break;
    }
    props.onClose();
  }

  function onKeyDown(event: KeyboardEvent): void {
    const count = flat().length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selected() + delta + count) % count);
      return;
    }
    if (event.key === "Enter" && count > 0) {
      event.preventDefault();
      execute(flat()[selectedIndex()]);
    }
    // Esc is handled by the kobalte dialog itself (closes via onClose).
  }

  // Keeps the keyboard-selected row visible inside the scrollable list.
  createEffect(() => {
    if (!props.open) return;
    // Track the selection so the effect re-runs when it changes.
    selectedIndex();
    const selectedEl = listRef?.querySelector<HTMLElement>('[aria-selected="true"]');
    // Optional call: jsdom lacks scrollIntoView; the WebView supports it.
    selectedEl?.scrollIntoView?.({ block: "nearest" });
  });

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="command-palette-overlay"
          class="fixed inset-0 z-40 bg-black/50"
        />
        <Dialog.Content
          data-testid="command-palette-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 flex w-full max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden"
          onOpenAutoFocus={(event) => {
            // The dialog focuses its content by default; the search input
            // is where the user wants to be.
            event.preventDefault();
            inputRef?.focus();
          }}
        >
          <Dialog.Title class="sr-only">Command palette</Dialog.Title>
          <div class="flex items-center gap-2.5 border-b border-bg-sunken px-4">
            <SearchIcon />
            <input
              ref={inputRef}
              data-testid="command-palette-input"
              type="text"
              value={query()}
              placeholder="Search sessions, files, commands, settings…"
              aria-label="Command palette"
              autocomplete="off"
              spellcheck={false}
              onInput={onInput}
              onKeyDown={onKeyDown}
              class="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-fg-faint"
            />
          </div>
          <div
            ref={listRef}
            data-testid="command-palette-list"
            role="listbox"
            aria-label="Results"
            class="max-h-96 overflow-y-auto py-1.5"
          >
            <Show
              when={showLoading()}
              fallback={
                <Show
                  when={flat().length > 0}
                  fallback={<EmptyRow testId="command-palette-empty" label="No matches" />}
                >
                  <For each={groupsWithOffsets()}>
                    {(group) => (
                      <div role="group" aria-label={group.label}>
                        <div
                          data-testid={`command-palette-section-${group.section}`}
                          class="px-4 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint"
                        >
                          {group.label}
                        </div>
                        <For each={group.items}>
                          {(item, index) => (
                            <RowView
                              item={item}
                              selected={group.offset + index() === selectedIndex()}
                              onExecute={execute}
                            />
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                </Show>
              }
            >
              <EmptyRow testId="command-palette-loading" label="Searching…" />
            </Show>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default CommandPalette;
