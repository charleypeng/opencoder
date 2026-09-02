// Full-text search panel (TASK-M4-05): searches the workspace over
// GET /find and renders the matches grouped by file — one header per path
// with a match count, then one row per hit (line number + the matched
// line with its hit spans highlighted). Typing debounces 300ms with
// in-flight invalidation (the QuickOpen pattern) and Enter runs the
// search immediately. A regex toggle (.*) validates the pattern
// client-side before searching and passes a mock-only `regex=true` query
// flag: the 1.18.11 contract exposes only `pattern`, so a real server
// ignores the flag and matches literally — documented in
// docs/api-coverage.md. Clicking a hit opens the file in the viewer and
// targets its line (viewer store activeLine); the shell then hands the file
// to the right-side viewer while keeping the chat surface in the center.

import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createFindService, type FindMatch } from "../../services/find.js";
import { openTab, setActiveLine } from "../../stores/viewer.js";
import { getActiveDirectory } from "../../stores/project.js";
import { groupByFile, highlightSpans, type Span } from "./searchResults.js";
import { useT } from "../../i18n/index.js";

export interface SearchPanelProps {
  /** The server whose workspace is searched. */
  serverId: string;
  /** Called after a hit is opened (the shell switches back to the viewer). */
  onOpenHit?: (path: string) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

export function SearchIcon() {
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

/** Why a regex pattern cannot be compiled, or null when it is valid. */
function regexErrorOf(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function HighlightedLine(props: { text: string; spans: Span[] }) {
  const segments = createMemo(() => {
    const segments: { text: string; hit: boolean }[] = [];
    let cursor = 0;
    for (const span of props.spans) {
      const start = Math.max(0, Math.min(props.text.length, span.start));
      const end = Math.max(start, Math.min(props.text.length, span.end));
      if (start > cursor) segments.push({ text: props.text.slice(cursor, start), hit: false });
      segments.push({ text: props.text.slice(start, end), hit: true });
      cursor = end;
    }
    if (cursor < props.text.length) segments.push({ text: props.text.slice(cursor), hit: false });
    return segments;
  });
  return (
    <span class="whitespace-pre-wrap break-words">
      <For each={segments()}>
        {(segment) =>
          segment.hit ? (
            <mark data-testid="search-hit-mark" class="rounded-sm bg-accent/25 text-fg-primary">
              {segment.text}
            </mark>
          ) : (
            segment.text
          )
        }
      </For>
    </span>
  );
}

const SearchPanel: Component<SearchPanelProps> = (props) => {
  const t = useT();
  const [query, setQuery] = createSignal("");
  const [regexMode, setRegexMode] = createSignal(false);
  const [results, setResults] = createSignal<FindMatch[]>([]);
  // The pattern + mode the current results were fetched with (spans derive
  // from them, so results stay highlighted correctly while typing ahead).
  const [searchedWith, setSearchedWith] = createSignal<{ pattern: string; regex: boolean } | null>(
    null,
  );
  const [searching, setSearching] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fetchSeq = 0;

  const queryText = createMemo(() => query().trim());
  const regexError = createMemo(() =>
    regexMode() && queryText() !== "" ? regexErrorOf(queryText()) : null,
  );

  async function search(pattern: string, regex: boolean): Promise<void> {
    const seq = ++fetchSeq;
    setSearching(true);
    setError(null);
    try {
      const items = await createFindService(getApiClient()).search(pattern, { regex });
      if (seq !== fetchSeq) return; // stale response; a newer query owns the list
      setResults(items);
      setSearchedWith({ pattern, regex });
    } catch (err) {
      if (seq !== fetchSeq) return;
      setError(ApiError.fromUnknown(err).message);
      setResults([]);
      setSearchedWith(null);
    } finally {
      if (seq === fetchSeq) setSearching(false);
    }
  }

  /** Validates (regex mode) and runs the search for a trimmed pattern. */
  function run(pattern: string): void {
    if (regexMode() && regexErrorOf(pattern) !== null) {
      // Invalid regex: never hit the server; the error hint is derived.
      setSearching(false);
      setResults([]);
      setSearchedWith(null);
      setError(null);
      return;
    }
    void search(pattern, regexMode());
  }

  function onInput(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value;
    setQuery(value);
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (value.trim() === "") {
      // Back to idle: cancel any pending + in-flight search.
      fetchSeq += 1;
      setSearching(false);
      setError(null);
      setResults([]);
      setSearchedWith(null);
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      run(value.trim());
    }, SEARCH_DEBOUNCE_MS);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || queryText() === "") return;
    event.preventDefault();
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    run(queryText());
  }

  function toggleRegex(): void {
    setRegexMode((mode) => !mode);
    if (queryText() === "") return;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    run(queryText());
  }

  function openHit(match: FindMatch): void {
    openTab(props.serverId, match.path.text);
    setActiveLine(props.serverId, match.path.text, match.line_number);
    props.onOpenHit?.(match.path.text);
  }

  // Pending timers never survive unmount (e.g. leaving the workspace).
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
    fetchSeq += 1;
  });

  const groups = createMemo(() => groupByFile(results()));
  const spanIndex = createMemo(() => {
    const map = new Map<FindMatch, Span[]>();
    const searched = searchedWith();
    if (searched !== null) {
      for (const match of results()) {
        map.set(match, highlightSpans(match, searched.pattern, searched.regex));
      }
    }
    return map;
  });

  const view = createMemo(() => {
    if (queryText() === "") return { kind: "idle" } as const;
    if (regexError() !== null) return { kind: "regex-error" } as const;
    if (error() !== null) return { kind: "error" } as const;
    if (searching() && results().length === 0) return { kind: "loading" } as const;
    if (results().length === 0) return { kind: "empty" } as const;
    return { kind: "results" } as const;
  });

  return (
    <div data-testid="search-panel" class="flex h-full min-h-0 flex-col">
      <div class="flex shrink-0 items-center gap-2 border-b border-bg-sunken px-3 py-2">
        <SearchIcon />
        <input
          data-testid="search-input"
          type="text"
          value={query()}
          placeholder={t("files:searchWorkspace")}
          aria-label={t("files:searchWorkspace")}
          autocomplete="off"
          spellcheck={false}
          onInput={onInput}
          onKeyDown={onKeyDown}
          class="w-full bg-transparent py-1 text-sm outline-none placeholder:text-fg-faint"
        />
        <button
          type="button"
          data-testid="search-regex-toggle"
          aria-pressed={regexMode() ? "true" : "false"}
          aria-label={t("files:useRegex")}
          title={t("files:regexHint")}
          onClick={toggleRegex}
          class={`shrink-0 rounded-md border px-2 py-0.5 font-code text-xs outline-none transition-colors ${
            regexMode()
              ? "border-accent text-accent"
              : "border-bg-sunken text-fg-faint hover:text-fg-secondary"
          }`}
        >
          .*
        </button>
      </div>
      <Show
        when={view().kind === "idle"}
        fallback={
          <Show
            when={view().kind === "regex-error"}
            fallback={
              <Show
                when={view().kind === "error"}
                fallback={
                  <Show
                    when={view().kind === "loading"}
                    fallback={
                      <Show
                        when={view().kind === "empty"}
                        fallback={
                          <div
                            data-testid="search-results"
                            class="min-h-0 flex-1 overflow-y-auto pb-2"
                          >
                            <For each={groups()}>
                              {(group) => (
                                <div data-testid={`search-group-${group.path}`}>
                                  <header class="flex items-center justify-between gap-2 px-3 pb-1 pt-2.5">
                                    <span class="truncate font-code text-xs text-fg-secondary">
                                      {group.path}
                                    </span>
                                    <span class="shrink-0 font-code text-[11px] text-fg-faint">
                                      {group.matches.length}
                                    </span>
                                  </header>
                                  <For each={group.matches}>
                                    {(match) => (
                                      <button
                                        type="button"
                                        data-testid={`search-hit-${match.path.text}-${match.line_number}`}
                                        title={`${match.path.text}:${match.line_number}`}
                                        onClick={() => openHit(match)}
                                        class="flex w-full items-start gap-2 px-3 py-1 text-left outline-none hover:bg-bg-sunken"
                                      >
                                        <span class="w-8 shrink-0 text-right font-code text-xs text-fg-faint">
                                          {match.line_number}
                                        </span>
                                        <span class="min-w-0 flex-1 font-code text-xs text-fg-secondary">
                                          <HighlightedLine
                                            text={match.lines.text}
                                            spans={spanIndex().get(match) ?? []}
                                          />
                                        </span>
                                      </button>
                                    )}
                                  </For>
                                </div>
                              )}
                            </For>
                          </div>
                        }
                      >
                        <p data-testid="search-empty" class="px-4 py-3 text-xs text-fg-faint">
                          {/* Scope line (docs/ui-audit-2026-08 §3): say WHICH
                              directory was searched — /find has no directory
                              parameter, the scope is the active workspace. */}
                          {getActiveDirectory() !== undefined
                            ? t("files:noMatchesScope", {
                                directory: getActiveDirectory() as string,
                              })
                            : t("common:noMatches")}
                        </p>
                      </Show>
                    }
                  >
                    <p data-testid="search-loading" class="px-4 py-3 text-xs text-fg-faint">
                      {t("files:searching")}
                    </p>
                  </Show>
                }
              >
                <p data-testid="search-error" class="px-4 py-3 text-xs text-danger">
                  {t("files:searchFailed")} — {error()}
                </p>
              </Show>
            }
          >
            <p data-testid="search-regex-error" class="px-4 py-3 text-xs text-warning">
              {t("files:invalidRegex")} — {regexError()}
            </p>
          </Show>
        }
      >
        <p data-testid="search-idle" class="px-4 py-3 text-xs text-fg-faint">
          {t("files:searchIdleHint")}
        </p>
      </Show>
    </div>
  );
};

export default SearchPanel;
