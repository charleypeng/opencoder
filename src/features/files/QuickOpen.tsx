// Quick open (⌘/Ctrl+P) dialog (TASK-M4-04 / TASK-M4-06): a kobalte modal
// that searches the workspace over GET /find/file — and, when the query
// starts with `#` (a trigger + at least one more character), over GET
// /find/symbol instead, showing symbol rows with a kind glyph and jumping
// to the symbol's file + line. Typing debounces 150ms and invalidates
// in-flight responses (the same pattern as the PromptBox @-menu — the core
// is deliberately not extracted: the @ menu is caret-insertion driven while
// this dialog owns a full open/close lifecycle). ↑↓ wrap through the ranked
// results (prefix matches first, then substring, then fuzzy; recent files
// first inside each bucket), Enter or a click opens the file — viewer store
// tab + per-server recent memory + the DesktopShell view switch — and
// closes the dialog. An empty query shows the per-server recent files
// instead of searching. The `variant` prop reserves the M7 mobile
// top-search page; the modal is the only form today.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { getApiClient } from "../../services/client.js";
import { createFindService } from "../../services/find.js";
import { getActiveDirectory } from "../../stores/project.js";
import { openTab, setActiveLine } from "../../stores/viewer.js";
import { pushRecentFile, readRecentFiles } from "./recentFiles.js";
import { rankResults, type RankedEntry } from "./rankResults.js";
import {
  isSymbolQuery,
  symbolHitOf,
  symbolKindIcon,
  symbolQueryOf,
  type SymbolHit,
} from "./symbols.js";

export interface QuickOpenProps {
  /** The server whose workspace is searched. */
  serverId: string;
  /** Controlled visibility (DesktopShell's ⌘/Ctrl+P state). */
  open: boolean;
  /** Called when the dialog is dismissed (Esc / overlay / open). */
  onClose: () => void;
  /** Called after a file is opened (DesktopShell switches Main to Files). */
  onOpenFile?: (path: string) => void;
  /** Reserved for the M7 mobile top-search page; modal only today. */
  variant?: "modal" | "page";
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

function FileRows(props: {
  entries: RankedEntry[];
  selected: () => number;
  onOpen: (path: string) => void;
}) {
  return (
    <For each={props.entries}>
      {(entry, index) => (
        <button
          type="button"
          role="option"
          data-testid={`quick-open-item-${entry.path}`}
          aria-selected={index() === props.selected() ? "true" : "false"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onOpen(entry.path)}
          class={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm outline-none ${
            index() === props.selected() ? "bg-bg-sunken" : ""
          }`}
        >
          <span class="truncate font-code text-xs text-fg-default">{entry.path}</span>
        </button>
      )}
    </For>
  );
}

function SymbolRows(props: {
  entries: SymbolHit[];
  selected: () => number;
  onOpen: (hit: SymbolHit) => void;
}) {
  return (
    <For each={props.entries}>
      {(entry, index) => (
        <button
          type="button"
          role="option"
          data-testid={`quick-open-symbol-${entry.name}`}
          aria-selected={index() === props.selected() ? "true" : "false"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onOpen(entry)}
          class={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm outline-none ${
            index() === props.selected() ? "bg-bg-sunken" : ""
          }`}
        >
          <span aria-hidden="true" class="w-4 shrink-0 text-center font-code text-xs text-fg-faint">
            {symbolKindIcon(entry.kind)}
          </span>
          <span class="truncate font-code text-xs text-fg-default">{entry.name}</span>
          <span class="truncate text-xs text-fg-faint">{entry.path}</span>
        </button>
      )}
    </For>
  );
}

const QuickOpen: Component<QuickOpenProps> = (props) => {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<RankedEntry[]>([]);
  const [symbols, setSymbols] = createSignal<SymbolHit[]>([]);
  const [recent, setRecent] = createSignal<string[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  // Debounce timer + request sequence: the sequence invalidates in-flight
  // responses so a stale reply never lands (PromptBox @-menu pattern).
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fetchSeq = 0;
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  // Opening the dialog resets to the recent-file view and re-reads the
  // per-server memory; closing drops any pending debounce + in-flight work.
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
    setResults([]);
    setSymbols([]);
    setRecent(readRecentFiles(props.serverId));
    setSelected(0);
    setLoading(false);
  });

  // Pending timers never survive unmount (e.g. leaving the workspace).
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
    fetchSeq += 1;
  });

  // The visible entries: recent files for an empty query, ranked search
  // results otherwise.
  const queryText = createMemo(() => query().trim());
  const symbolMode = createMemo(() => isSymbolQuery(queryText()));
  const entries = createMemo<RankedEntry[]>(() => {
    if (queryText() === "") {
      return recent().map((path) => ({ path, bucket: 0, recentIndex: 0 }));
    }
    return results();
  });
  // Row count for keyboard navigation across both modes.
  const rowCount = createMemo(() => {
    if (queryText() === "") return recent().length;
    if (symbolMode()) return symbols().length;
    return results().length;
  });

  async function search(value: string): Promise<void> {
    const seq = ++fetchSeq;
    setLoading(true);
    try {
      const find = createFindService(getApiClient());
      if (isSymbolQuery(value)) {
        const items = await find.symbols(symbolQueryOf(value));
        if (seq !== fetchSeq) return; // stale response; a newer query owns the list
        setSymbols(items.map((symbol) => symbolHitOf(symbol, getActiveDirectory())));
        setSelected(0);
      } else {
        const items = await find.files(value);
        if (seq !== fetchSeq) return; // stale response; a newer query owns the list
        setResults(rankResults(value, items, recent()));
        setSelected(0);
      }
    } catch {
      if (seq !== fetchSeq) return;
      // A failed search leaves the list empty ("No matches" / "No symbols
      // found" below); typing again re-searches.
      setResults([]);
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
      // Back to the recent view: cancel any in-flight search.
      fetchSeq += 1;
      setLoading(false);
      setResults([]);
      setSymbols([]);
      setSelected(0);
      return;
    }
    setResults([]);
    setSymbols([]);
    setSelected(0);
    timer = setTimeout(() => {
      timer = undefined;
      void search(value.trim());
    }, SEARCH_DEBOUNCE_MS);
  }

  function openFile(path: string): void {
    openTab(props.serverId, path);
    pushRecentFile(props.serverId, path);
    props.onOpenFile?.(path);
    props.onClose();
  }

  function openSymbol(hit: SymbolHit): void {
    openTab(props.serverId, hit.path);
    setActiveLine(props.serverId, hit.path, hit.line);
    pushRecentFile(props.serverId, hit.path);
    props.onOpenFile?.(hit.path);
    props.onClose();
  }

  function openAt(index: number): void {
    if (queryText() === "") {
      const path = recent()[index];
      if (path !== undefined) openFile(path);
      return;
    }
    if (symbolMode()) {
      const hit = symbols()[index];
      if (hit !== undefined) openSymbol(hit);
      return;
    }
    const entry = results()[index];
    if (entry !== undefined) openFile(entry.path);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const count = rowCount();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selected() + delta + count) % count);
      return;
    }
    if (event.key === "Enter" && count > 0) {
      event.preventDefault();
      openAt(selected());
    }
    // Esc is handled by the kobalte dialog itself (closes via onClose).
  }

  // Keeps the keyboard-selected row visible inside the scrollable list.
  createEffect(() => {
    if (!props.open) return;
    // Track the selection so the effect re-runs when it changes.
    selected();
    const selectedEl = listRef?.querySelector<HTMLElement>('[aria-selected="true"]');
    // Optional call: jsdom lacks scrollIntoView; the WebView supports it.
    selectedEl?.scrollIntoView?.({ block: "nearest" });
  });

  const view = createMemo(() => {
    if (queryText() === "") return { kind: "recent" } as const;
    if (loading() && rowCount() === 0) return { kind: "loading" } as const;
    if (symbolMode()) {
      return symbols().length === 0
        ? ({ kind: "symbols-empty" } as const)
        : ({ kind: "symbols" } as const);
    }
    if (results().length === 0) return { kind: "empty" } as const;
    return { kind: "list" } as const;
  });

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay data-testid="quick-open-overlay" class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="quick-open-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 flex w-full max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden"
          onOpenAutoFocus={(event) => {
            // The dialog focuses its content by default; the search input
            // is where the user wants to be.
            event.preventDefault();
            inputRef?.focus();
          }}
        >
          <Dialog.Title class="sr-only">Open file</Dialog.Title>
          <div class="flex items-center gap-2.5 border-b border-bg-sunken px-4">
            <SearchIcon />
            <input
              ref={inputRef}
              data-testid="quick-open-input"
              type="text"
              value={query()}
              placeholder="Search files…"
              aria-label="Search files"
              autocomplete="off"
              spellcheck={false}
              onInput={onInput}
              onKeyDown={onKeyDown}
              class="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-fg-faint"
            />
          </div>
          <div
            ref={listRef}
            data-testid="quick-open-list"
            role="listbox"
            aria-label="Files"
            class="max-h-80 overflow-y-auto py-1.5"
          >
            <Show
              when={view().kind === "recent"}
              fallback={
                <Show
                  when={view().kind === "loading"}
                  fallback={
                    <Show
                      when={view().kind === "list"}
                      fallback={
                        <Show
                          when={view().kind === "symbols"}
                          fallback={
                            <Show
                              when={view().kind === "symbols-empty"}
                              fallback={<EmptyRow testId="quick-open-empty" label="No matches" />}
                            >
                              <EmptyRow
                                testId="quick-open-symbols-empty"
                                label="No symbols found"
                              />
                            </Show>
                          }
                        >
                          <SymbolRows entries={symbols()} selected={selected} onOpen={openSymbol} />
                        </Show>
                      }
                    >
                      <FileRows entries={entries()} selected={selected} onOpen={openFile} />
                    </Show>
                  }
                >
                  <EmptyRow testId="quick-open-loading" label="Searching…" />
                </Show>
              }
            >
              <Show
                when={recent().length > 0}
                fallback={<EmptyRow testId="quick-open-no-recent" label="No recent files" />}
              >
                <div
                  data-testid="quick-open-recent-header"
                  class="px-4 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint"
                >
                  Recent
                </div>
                <FileRows entries={entries()} selected={selected} onOpen={openFile} />
              </Show>
            </Show>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default QuickOpen;
