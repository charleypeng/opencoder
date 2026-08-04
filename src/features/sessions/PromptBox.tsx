// Prompt input box (TASK-M2-08): the chat composer pinned below the message
// list. An auto-growing textarea sends on ⌘/Ctrl+Enter (plain Enter inserts
// a newline); ↑ on an empty input recalls the last sent prompt and keeps
// cycling through the per-server history. Sending goes through the shared
// sendPrompt pipeline (optimistic user message, rollback + inline banner on
// failure); while the session is generating (busy/retry status from the
// store) the input is locked with a "Generating…" placeholder and the Send
// button is replaced by a Stop button — Esc does the same — which calls
// POST /session/{id}/abort (TASK-M2-10; a local aborting lock prevents
// double clicks; an abort failure surfaces as the inline banner). The thin
// streaming progress bar lives at the top of the chat area in MessageList
// (TASK-M2-09, single source: session busy status).
//
// TASK-M3-08 (attachments & @ file references): clipboard images and
// dropped/picked files become removable attachment chips above the
// textarea (images and large/binary files as base64 data URLs, small
// text-like files as plain text) and are sent as FilePartInput parts
// (cleared on success, kept for retry on failure). `@` at a word start
// opens a debounced (150ms, in-flight responses invalidated) file
// reference menu over GET /find/file with ↑↓/Enter/Esc navigation that
// inserts `@<path>` at the caret. Drops use the plain HTML5 handlers —
// File objects from a WebView drop carry no absolute path; when Tauri
// v2's onDragDropEvent is wired the path could be attached there. The
// image picker button is a disabled M7 placeholder (mobile dialog plugin).

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createFindService } from "../../services/find.js";
import { createSessionService } from "../../services/session.js";
import { untrackPendingLocalMessage } from "../../stores/messages.js";
import { getServerSessionState } from "../../stores/session.js";
import { type Attachment, fileToAttachment } from "./attachments.js";
import { promptAt } from "./promptHistory.js";
import { sendPrompt } from "./sendPrompt.js";

export interface PromptBoxProps {
  /** The server whose session is composed in. */
  serverId: string;
  /** The active session the prompt is sent to. */
  sessionId: string;
  /** Hard-disabled (no session context); store status still locks below. */
  disabled?: boolean;
}

const MAX_TEXTAREA_HEIGHT = 220; // ~10 lines, then the box scrolls internally
const AT_DEBOUNCE_MS = 150;

/** Open @-reference menu state (TASK-M3-08). */
interface AtMenuState {
  /** The word after the triggering `@`. */
  query: string;
  items: string[];
  selected: number;
}

function PaperclipIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-3 w-3"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-3 w-3"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function SquareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}

/** Grows the textarea to its content, capped at the max box height. */
function resizeToContent(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
}

/** `@` at a word start (beginning of input or after whitespace). */
function atQueryAt(el: HTMLTextAreaElement): { atIndex: number; query: string } | null {
  const before = el.value.slice(0, el.selectionStart);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return null;
  const prefix = before.slice(0, atIndex);
  if (prefix !== "" && !/\s$/.test(prefix)) return null;
  const query = before.slice(atIndex + 1);
  if (query.includes(" ")) return null;
  return { atIndex, query };
}

const PromptBox: Component<PromptBoxProps> = (props) => {
  const [text, setText] = createSignal("");
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [sending, setSending] = createSignal(false);
  const [inlineError, setInlineError] = createSignal<ApiError | null>(null);
  // Local lock while an abort request is in flight (no double stops).
  const [aborting, setAborting] = createSignal(false);
  // -1 = not browsing; >= 0 = index into the history list (0 is most recent).
  const [browseIndex, setBrowseIndex] = createSignal(-1);
  const [atMenu, setAtMenu] = createSignal<AtMenuState | null>(null);
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  // Debounce timer + request sequence for the @-reference search: the
  // sequence invalidates in-flight responses so a stale reply never lands.
  let atTimer: ReturnType<typeof setTimeout> | undefined;
  let atFetchSeq = 0;
  // Suppresses one refresh after a path insert so the inserted `@path`
  // does not immediately reopen the menu.
  let suppressAtRefresh = false;

  // Store-driven generating lock: busy/retry means the session is streaming.
  const status = createMemo(() => getServerSessionState(props.serverId).statuses[props.sessionId]);
  const busy = createMemo(() => status()?.type === "busy" || status()?.type === "retry");
  const disabled = () => props.disabled === true || busy() || sending();
  const canSend = () => !disabled() && (text().trim() !== "" || attachments().length > 0);

  // TASK-M2-08: a prompt the server never echoes keeps its optimistic bubble;
  // the pending marker is dropped when the composed session changes or the
  // box unmounts so another session's events never reconcile against it.
  createEffect(() => {
    const sessionId = props.sessionId;
    onCleanup(() => untrackPendingLocalMessage(props.serverId, sessionId));
  });

  onCleanup(() => {
    if (atTimer !== undefined) clearTimeout(atTimer);
  });

  // Esc aborts generation from anywhere while the session is generating
  // (the textarea is disabled then and cannot receive the key itself); a
  // focused widget that handled the key (e.g. a dialog) wins via the
  // defaultPrevented check.
  createEffect(() => {
    if (!busy()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      void stopGeneration();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  function applyHeight(el: HTMLTextAreaElement): void {
    // Browsing fills the value programmatically; resize so the textarea
    // never shows a scrollbar right after a recall.
    queueMicrotask(() => resizeToContent(el));
  }

  function exitBrowse(): void {
    setBrowseIndex(-1);
  }

  function recall(): void {
    const next = promptAt(props.serverId, browseIndex());
    if (next === undefined) return;
    setText(next);
    const el = textareaRef;
    if (el !== undefined) {
      el.value = next;
      el.selectionStart = el.selectionEnd = next.length;
      applyHeight(el);
    }
  }

  function browseOlder(): void {
    const nextIndex = browseIndex() + 1;
    // The oldest entry reached: stay put instead of wrapping around.
    if (promptAt(props.serverId, nextIndex) === undefined) return;
    setBrowseIndex(nextIndex);
    recall();
  }

  function browseNewer(): void {
    if (browseIndex() < 0) return;
    const nextIndex = browseIndex() - 1;
    setBrowseIndex(nextIndex);
    if (nextIndex < 0) {
      // Past the newest entry: back to an empty input.
      setText("");
      const el = textareaRef;
      if (el !== undefined) {
        el.value = "";
        applyHeight(el);
      }
    } else {
      recall();
    }
  }

  function closeAtMenu(): void {
    if (atTimer !== undefined) {
      clearTimeout(atTimer);
      atTimer = undefined;
    }
    atFetchSeq += 1;
    setAtMenu(null);
  }

  async function fetchAtResults(query: string): Promise<void> {
    const seq = ++atFetchSeq;
    try {
      const items = await createFindService(getApiClient()).files(query);
      if (seq !== atFetchSeq) return; // stale response; a newer query owns the menu
      setAtMenu((prev) => (prev?.query === query ? { query, items, selected: 0 } : prev));
    } catch {
      // Search failures close the menu silently; typing is unaffected.
      if (seq === atFetchSeq) setAtMenu(null);
    }
  }

  function refreshAtMenu(el: HTMLTextAreaElement): void {
    if (suppressAtRefresh) {
      suppressAtRefresh = false;
      return;
    }
    if (atTimer !== undefined) {
      clearTimeout(atTimer);
      atTimer = undefined;
    }
    const hit = atQueryAt(el);
    if (hit === null || hit.query === "") {
      closeAtMenu();
      return;
    }
    setAtMenu((prev) =>
      prev === null || prev.query !== hit.query
        ? { query: hit.query, items: [], selected: 0 }
        : prev,
    );
    atTimer = setTimeout(() => {
      atTimer = undefined;
      void fetchAtResults(hit.query);
    }, AT_DEBOUNCE_MS);
  }

  function insertAtReference(path: string): void {
    const el = textareaRef;
    if (el !== undefined) {
      const hit = atQueryAt(el);
      const start = hit?.atIndex ?? el.value.lastIndexOf("@");
      const next = `${el.value.slice(0, start)}@${path}${el.value.slice(el.selectionStart)}`;
      el.value = next;
      setText(next);
      el.selectionStart = el.selectionEnd = next.length;
      applyHeight(el);
    }
    suppressAtRefresh = true;
    closeAtMenu();
  }

  async function addFileAttachment(file: File): Promise<void> {
    try {
      const attachment = await fileToAttachment(file);
      setAttachments((prev) => [...prev, attachment]);
    } catch {
      // Unreadable file: skip silently.
    }
  }

  function removeAttachment(id: string): void {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }

  function onKeyDown(event: KeyboardEvent) {
    // The @-reference menu owns arrow/enter/escape keys while open.
    const menu = atMenu();
    if (menu !== null) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAtMenu();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const count = menu.items.length;
        const selected = count === 0 ? 0 : (menu.selected + delta + count) % count;
        setAtMenu({ ...menu, selected });
        return;
      }
      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && menu.items.length > 0) {
        event.preventDefault();
        insertAtReference(menu.items[menu.selected]);
        return;
      }
    }
    // Esc exits prompt history browsing (the browser default, e.g. closing
    // overlays, is kept when not browsing).
    if (event.key === "Escape") {
      if (browseIndex() >= 0) {
        event.preventDefault();
        setBrowseIndex(-1);
      }
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === "ArrowUp" && !event.shiftKey) {
      const el = event.currentTarget as HTMLTextAreaElement;
      if (browseIndex() >= 0 || el.selectionStart === 0) {
        event.preventDefault();
        browseOlder();
      }
      return;
    }
    if (event.key === "ArrowDown" && !event.shiftKey) {
      if (browseIndex() >= 0) {
        event.preventDefault();
        browseNewer();
      }
    }
  }

  function onInput(event: Event) {
    const el = event.currentTarget as HTMLTextAreaElement;
    setText(el.value);
    if (browseIndex() >= 0) exitBrowse();
    resizeToContent(el);
    refreshAtMenu(el);
  }

  function onPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (items === undefined) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file === null) continue;
      event.preventDefault();
      void addFileAttachment(file);
      return;
    }
  }

  function onDrop(event: DragEvent) {
    if (disabled()) return;
    const files = event.dataTransfer?.files;
    if (files === undefined || files.length === 0) return;
    event.preventDefault();
    for (const file of Array.from(files)) void addFileAttachment(file);
  }

  function onFileInputChange(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    for (const file of Array.from(el.files ?? [])) void addFileAttachment(file);
    // Reset so picking the same file again re-fires the change event.
    el.value = "";
  }

  async function send() {
    const message = text().trim();
    const atts = attachments();
    if ((message === "" && atts.length === 0) || disabled()) return;
    closeAtMenu();
    // Clear the input immediately; sendPrompt handles the store side.
    setText("");
    const el = textareaRef;
    if (el !== undefined) {
      el.value = "";
      applyHeight(el);
    }
    exitBrowse();
    setSending(true);
    setInlineError(null);
    try {
      const err = await sendPrompt(props.serverId, props.sessionId, message, atts);
      // Chips clear on success only; a failed send keeps them for retry.
      if (err === null) setAttachments([]);
      setInlineError(err);
    } finally {
      setSending(false);
    }
  }

  async function stopGeneration() {
    if (aborting() || !busy()) return;
    setAborting(true);
    setInlineError(null);
    try {
      // The server answers with session.status idle via SSE, which flips
      // the busy lock and restores the Send button.
      await createSessionService(getApiClient()).abort(props.sessionId);
    } catch (err) {
      setInlineError(ApiError.fromUnknown(err));
    } finally {
      setAborting(false);
    }
  }

  // Memoized snapshots: component bodies run once, and reading a plain
  // signal twice inside a JSX conditional can tear when it flips between
  // the reads — memos cache their value, so both issues are avoided.
  const menu = createMemo(() => atMenu());
  const atts = createMemo(() => attachments());

  return (
    <div
      data-testid="prompt-box"
      class="shrink-0 border-t border-bg-sunken bg-bg-elevated"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div class="flex items-end gap-2 px-4 py-3">
        <div class="min-w-0 flex-1">
          <ErrorBanner error={inlineError()} onDismiss={() => setInlineError(null)} />
          <div class="relative flex items-end gap-1.5 rounded-lg border border-bg-sunken bg-bg-sunken px-2 py-1.5 focus-within:border-fg-faint">
            <Show when={menu()} fallback={null}>
              {(m) => (
                <div
                  data-testid="prompt-at-menu"
                  role="listbox"
                  aria-label="File references"
                  class="absolute bottom-full left-0 z-10 mb-1 max-h-56 w-full overflow-y-auto rounded-lg border border-bg-sunken bg-bg-elevated py-1 shadow-lg"
                >
                  <Show
                    when={m().items.length > 0}
                    fallback={<div class="px-3 py-1.5 text-xs text-fg-faint">No matches</div>}
                  >
                    <For each={m().items}>
                      {(path, index) => (
                        <button
                          type="button"
                          data-testid="prompt-at-item"
                          role="option"
                          aria-selected={index() === m().selected}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertAtReference(path)}
                          class={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                            index() === m().selected ? "bg-bg-sunken" : ""
                          }`}
                        >
                          <span class="truncate font-mono text-fg-default">{path}</span>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={atts().length > 0}>
              <div class="flex flex-wrap gap-1.5 pb-1.5" data-testid="attachment-chips">
                <For each={atts()}>
                  {(attachment) => (
                    <span
                      data-testid="attachment-chip"
                      class="flex items-center gap-1.5 rounded-full border border-bg-sunken bg-bg-base py-0.5 pl-2 pr-1 text-xs text-fg-default"
                    >
                      {attachment.kind === "image" ? <ImageIcon /> : <FileIcon />}
                      <span class="max-w-40 truncate" title={attachment.name}>
                        {attachment.name}
                      </span>
                      <button
                        type="button"
                        data-testid="attachment-remove"
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() => removeAttachment(attachment.id)}
                        class="flex h-4 w-4 items-center justify-center rounded-full text-fg-faint hover:text-danger"
                      >
                        <XIcon />
                      </button>
                    </span>
                  )}
                </For>
              </div>
            </Show>
            <div class="flex items-center gap-1">
              <button
                type="button"
                data-testid="prompt-attach"
                aria-label="Attachments"
                title="Add files"
                disabled={disabled()}
                onClick={() => fileInputRef?.click()}
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-bg-base hover:text-fg-default disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PaperclipIcon />
              </button>
              <button
                type="button"
                data-testid="prompt-pick-image"
                aria-label="Pick image"
                // M7 wires the mobile system image picker (dialog plugin)
                // plus platform detection; until then the picker is inert.
                title="Image picker — M7"
                disabled
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint"
              >
                <ImageIcon />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                data-testid="prompt-file-input"
                aria-hidden="true"
                tabIndex={-1}
                class="hidden"
                onChange={onFileInputChange}
              />
            </div>
            <textarea
              ref={textareaRef}
              data-testid="prompt-input"
              rows={1}
              value={text()}
              placeholder={busy() ? "Generating…" : "Message"}
              disabled={disabled()}
              aria-label="Message"
              onInput={onInput}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={closeAtMenu}
              class="max-h-[220px] min-h-[2rem] flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 outline-none placeholder:text-fg-faint disabled:cursor-not-allowed"
            />
            {busy() ? (
              <button
                type="button"
                data-testid="prompt-stop"
                aria-label="Stop generating"
                title="Stop (Esc)"
                disabled={aborting()}
                onClick={() => void stopGeneration()}
                class="mb-0.5 flex shrink-0 items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-bg-base outline-none transition-opacity hover:opacity-90 focus:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SquareIcon />
                Stop
              </button>
            ) : (
              <button
                type="button"
                data-testid="prompt-send"
                disabled={!canSend()}
                onClick={() => void send()}
                class="mb-0.5 shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg-base outline-none transition-opacity hover:opacity-90 focus:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>
          <p class="mt-1 px-1 text-xs text-fg-faint">
            {busy() ? "Generating — Esc to stop" : "⌘/Ctrl+Enter to send"}
          </p>
        </div>
      </div>
    </div>
  );
};

export default PromptBox;
