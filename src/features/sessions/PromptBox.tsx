// Prompt input box (TASK-M2-08): the chat composer pinned below the message
// list. An auto-growing textarea sends on ⌘/Ctrl+Enter (plain Enter inserts
// a newline); ↑ on an empty input recalls the last sent prompt and keeps
// cycling through the per-server history. Sending is optimistic: the user
// message is inserted into the messages store immediately, the textarea is
// cleared, and the POST /session/{id}/prompt_async round-trip happens in the
// background — on failure the optimistic message is rolled back and an
// inline banner shows the error. The server echo (message.updated under a
// real id) reconciles the local bubble onto the echoed message instead of
// leaving a duplicate (see trackPendingLocalMessage in the messages store);
// a prompt the server never echoes keeps its optimistic bubble, same as a
// silent server. While the session is generating (busy/retry
// status from the store) the input is locked with a "Generating…" placeholder;
// the thin streaming progress bar lives at the top of the chat area in
// MessageList (TASK-M2-09, single source: session busy status). The Esc abort
// and stop button land in M2-10. The attachment button is a disabled
// placeholder for M3 (file parts).

import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Component } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createSessionService } from "../../services/session.js";
import type { Message, Part } from "../../stores/messages.js";
import {
  applyPartDelta,
  removePartsForMessage,
  trackPendingLocalMessage,
  untrackPendingLocalMessage,
  upsertMessage,
} from "../../stores/messages.js";
import { getServerSessionState } from "../../stores/session.js";
import { promptAt, pushPrompt } from "./promptHistory.js";

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

/** Grows the textarea to its content, capped at the max box height. */
function resizeToContent(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
}

const PromptBox: Component<PromptBoxProps> = (props) => {
  const [text, setText] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [sendError, setSendError] = createSignal<ApiError | null>(null);
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
    // Esc: M2-10 wires the abort here; for now it only exits prompt history
    // browsing (and the browser default, e.g. closing overlays, is kept).
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
    const now = Date.now();
    const localMessageId = `local-${now}`;
    const localPartId = `local-part-${now}`;
    const session = getServerSessionState(props.serverId).sessions[props.sessionId];

    // Optimistic local insert so the bubble appears before the server echoes
    // it back through SSE; the tracked pending id lets the first real
    // message.updated roll this local message over onto the echo.
    // The session's model uses { id, providerID } while a user message
    // expects { providerID, modelID }, so the fields are mapped.
    const optimistic: Message = {
      id: localMessageId,
      sessionID: props.sessionId,
      role: "user",
      time: { created: now },
      agent: session?.agent ?? "",
      model: {
        providerID: session?.model?.providerID ?? "",
        modelID: session?.model?.id ?? "",
      },
    };
    const part: Part = {
      id: localPartId,
      sessionID: props.sessionId,
      messageID: localMessageId,
      type: "text",
      text: message,
    };
    upsertMessage(props.serverId, props.sessionId, optimistic);
    applyPartDelta(props.serverId, props.sessionId, part);
    trackPendingLocalMessage(props.serverId, props.sessionId, localMessageId);

    setText("");
    const el = textareaRef;
    if (el !== undefined) {
      el.value = "";
      applyHeight(el);
    }
    exitBrowse();
    pushPrompt(props.serverId, message);

    setSending(true);
    setSendError(null);
    try {
      await createSessionService(getApiClient()).promptAsync(props.sessionId, {
        parts: [{ type: "text", text: message }],
      });
    } catch (err) {
      // Roll the optimistic message back; on success the SSE echo would
      // have reconciled it. The pending marker is dropped either way.
      removePartsForMessage(props.serverId, props.sessionId, localMessageId);
      untrackPendingLocalMessage(props.serverId, props.sessionId);
      setSendError(ApiError.fromUnknown(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div data-testid="prompt-box" class="shrink-0 border-t border-bg-sunken bg-bg-elevated">
      <div class="flex items-end gap-2 px-4 py-3">
        <div class="min-w-0 flex-1">
          <ErrorBanner error={sendError()} onDismiss={() => setSendError(null)} />
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
            <button
              type="button"
              data-testid="prompt-send"
              disabled={!canSend()}
              onClick={() => void send()}
              class="mb-0.5 shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg-base outline-none transition-opacity hover:opacity-90 focus:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
          <p class="mt-1 px-1 text-xs text-fg-faint">
            {busy() ? "Generating — Esc to stop (M2-10)" : "⌘/Ctrl+Enter to send"}
          </p>
        </div>
      </div>
    </div>
  );
};

export default PromptBox;
