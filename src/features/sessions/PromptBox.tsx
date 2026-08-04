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
// (TASK-M2-09, single source: session busy status). The attachment button is
// a disabled placeholder for M3 (file parts).

import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Component } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createSessionService } from "../../services/session.js";
import { untrackPendingLocalMessage } from "../../stores/messages.js";
import { getServerSessionState } from "../../stores/session.js";
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

const PromptBox: Component<PromptBoxProps> = (props) => {
  const [text, setText] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [inlineError, setInlineError] = createSignal<ApiError | null>(null);
  // Local lock while an abort request is in flight (no double stops).
  const [aborting, setAborting] = createSignal(false);
  // -1 = not browsing; >= 0 = index into the history list (0 is most recent).
  const [browseIndex, setBrowseIndex] = createSignal(-1);
  let textareaRef: HTMLTextAreaElement | undefined;

  // Store-driven generating lock: busy/retry means the session is streaming.
  const status = createMemo(() => getServerSessionState(props.serverId).statuses[props.sessionId]);
  const busy = createMemo(() => status()?.type === "busy" || status()?.type === "retry");
  const disabled = () => props.disabled === true || busy() || sending();
  const canSend = () => !disabled() && text().trim() !== "";

  // TASK-M2-08: a prompt the server never echoes keeps its optimistic bubble;
  // the pending marker is dropped when the composed session changes or the
  // box unmounts so another session's events never reconcile against it.
  createEffect(() => {
    const sessionId = props.sessionId;
    onCleanup(() => untrackPendingLocalMessage(props.serverId, sessionId));
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

  function onKeyDown(event: KeyboardEvent) {
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
  }

  async function send() {
    const message = text().trim();
    if (message === "" || disabled()) return;
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
      setInlineError(await sendPrompt(props.serverId, props.sessionId, message));
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

  return (
    <div data-testid="prompt-box" class="shrink-0 border-t border-bg-sunken bg-bg-elevated">
      <div class="flex items-end gap-2 px-4 py-3">
        <div class="min-w-0 flex-1">
          <ErrorBanner error={inlineError()} onDismiss={() => setInlineError(null)} />
          <div class="flex items-end gap-1.5 rounded-lg border border-bg-sunken bg-bg-sunken px-2 py-1.5 focus-within:border-fg-faint">
            <button
              type="button"
              data-testid="prompt-attach"
              aria-label="Attachments"
              title="Attachments — M3"
              disabled
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint"
            >
              <PaperclipIcon />
            </button>
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
