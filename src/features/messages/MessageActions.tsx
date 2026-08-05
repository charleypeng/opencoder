// Message actions (TASK-M3-06): per-message hover toolbar and right-click
// context menu. The "⋯" trigger is revealed on row hover (group-hover, the
// bubble column is the group) and the same item set opens on contextmenu at
// the cursor (TASK-M8-03: both open ONE shared ContextMenu — the trigger at
// the button position, the right-click at the cursor; the Menu key opens it
// from the focused column via the browser's contextmenu event). Items:
//   - Copy text: all text parts of the message joined with newlines.
//   - Copy code: the bodies of fenced ```lang ... ``` blocks only; disabled
//     when the message has none.
//   - Edit and resend (user messages only): PATCHes the first text part with
//     the edited text, then re-prompts through the shared sendPrompt
//     pipeline (spec: PATCH + re-prompt). The dialog stays open with the
//     inline error when either leg fails.
//   - Delete (user messages only; deleting an assistant message would break
//     the server's parentID chain): confirmation dialog; the DELETE round-trip
//     runs before the store removal (deleteMessage), so a failure surfaces
//     inline in the still-mounted dialog instead of a silent rollback.
//   - View diff: placeholder until M4-07 wires the diff view; disabled while
//     no onViewDiff callback is provided.
//   - Fork from here (TASK-M6-03): forks the session at this message point;
//     disabled while no onFork callback is provided.
//   - Revert to here (TASK-M6-04): rolls the session back to this message
//     (file changes made after it are undone on the server); the confirm
//     dialog lives with the caller that wires onRevert (DesktopShell), so
//     the item is disabled while no onRevert callback is provided.
//
// TASK-M7-06: with `mobile` the column gains a LONG-PRESS action menu —
// holding still for 500ms opens the same ContextMenu with the touch-
// appropriate subset (copy text / copy code / delete), the release click
// is swallowed so a button under the finger never activates, and the iOS
// text-selection callout is suppressed (the menu replaces it). Long-press
// cancels on any drift past the slop, so scrolling never triggers it.
//
// The component owns the bubble column (MessageBubble passes its body as
// children), so hover state, the context menu and the store-driven role
// alignment live in one place.

import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import { Dialog } from "@kobalte/core";
import ContextMenu from "../../components/ContextMenu.js";
import type { MenuItem } from "../../components/ContextMenu.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { useErrorCopy } from "../../components/errorCopy.js";
import { useT } from "../../i18n/index.js";
import { createMessageService } from "../../services/message.js";
import { messages, applyPartDelta } from "../../stores/messages.js";
import type { Part } from "../../stores/messages.js";
import { sendPrompt } from "../sessions/sendPrompt.js";
import { deleteMessage } from "./deleteMessage.js";
import { useLongPress } from "../../shells/mobile/gestures.js";

export interface MessageActionsProps {
  /** The server whose session is shown. */
  serverId: string;
  /** The session to render. */
  sessionId: string;
  /** Message id; info and parts are read from the store by id. */
  messageID: string;
  /** Ordered part ids of this message (from the store's messageParts). */
  partIds: string[];
  /** Opens the M4 diff view for this message (wired by M4-07); while
   *  absent the "View diff" item stays disabled. */
  onViewDiff?: (messageID: string) => void;
  /** Forks the session from this message (wired by M6-03); while absent
   *  the "Fork from here" item stays disabled. */
  onFork?: (messageID: string) => void;
  /** Reverts the session to this message (wired by M6-04 — the caller
   *  shows the confirm dialog); while absent the "Revert to here" item
   *  stays disabled. */
  onRevert?: (messageID: string) => void;
  /** Bubble body (bubble + timestamp). */
  children?: JSX.Element;
  /** Mobile presentation (TASK-M7-06): the column long-presses open the
   *  touch menu (copy text / copy code / delete). */
  mobile?: boolean;
}

type TextPart = Extract<Part, { type: "text" }>;

/** Fenced code blocks (```lang\n body \n```); unterminated fences run to
 *  the end of the text. Returns the joined bodies or undefined when the
 *  text carries no fences. */
function codeFences(text: string): string | undefined {
  const blocks: string[] = [];
  const fence = /```[^\n`]*\n([\s\S]*?)(?:```|$)/g;
  for (const match of text.matchAll(fence)) {
    const body = match[1].replace(/\n$/, "");
    if (body.length > 0) blocks.push(body);
  }
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

/** Copies text via the async Clipboard API with a legacy execCommand
 *  fallback (mirrors MarkdownText / tools shared copy). */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

const actionClass =
  "rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm " +
  "text-fg-secondary hover:text-fg-primary";

// --- Edit dialog ----------------------------------------------------------

export interface EditMessageDialogProps {
  serverId: string;
  sessionId: string;
  messageID: string;
  /** The text part being edited (always present while mounted). */
  part: TextPart;
  onClose: () => void;
}

/** Edits one user message part (PATCH) and resends the edited text as a
 *  new prompt (sendPrompt). The dialog closes only when both legs
 *  succeeded; any failure shows the inline error and keeps it open — the
 *  PATCH may already have applied, so the user can retry the send or
 *  cancel. */
function EditMessageDialog(props: EditMessageDialogProps) {
  const t = useT();
  const { line: errorLine } = useErrorCopy();
  // Mounted per message (Show keyed), so one-time prefill is intentional.
  // eslint-disable-next-line solid/reactivity -- one-time prefill on open
  const [text, setText] = createSignal(props.part.text ?? "");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);

  const canSubmit = () => text().trim() !== "" && !saving();

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit()) return;
    setSaving(true);
    setError(null);
    // PATCH carries the full part (schema: request body is the Part
    // object); the raw text is kept as typed, sendPrompt trims its own
    // copy for the prompt payload.
    const updated: TextPart = { ...props.part, text: text() };
    try {
      const patched = await createMessageService(getApiClient()).updatePart(
        props.sessionId,
        props.messageID,
        props.part.id,
        updated,
      );
      applyPartDelta(props.serverId, props.sessionId, patched);
    } catch (err) {
      setError(ApiError.fromUnknown(err));
      setSaving(false);
      return;
    }
    const sendErr = await sendPrompt(props.serverId, props.sessionId, text().trim());
    if (sendErr !== null) {
      setError(sendErr);
      setSaving(false);
      return;
    }
    props.onClose();
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        // Esc / overlay while saving must not orphan the in-flight PATCH;
        // the guard in onSubmit is the backstop.
        if (!open && !saving()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="edit-message-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title class="text-md font-semibold">
            {t("messages:editMessageTitle")}
          </Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            {t("messages:editMessageHint")}
          </Dialog.Description>

          <form data-testid="edit-message-form" class="mt-5 space-y-4" onSubmit={onSubmit}>
            <label class="block">
              <span class="text-sm font-medium text-fg-secondary">{t("messages:message")}</span>
              <textarea
                data-testid="edit-message-input"
                class="mt-1 min-h-24 w-full resize-y rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 font-code text-sm text-fg-primary placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                value={text()}
                onInput={(event) => setText(event.currentTarget.value)}
              />
            </label>
            <Show when={error()}>
              <p data-testid="edit-message-error" class="text-sm text-danger">
                {errorLine(error()!)}
              </p>
            </Show>
            <div class="flex justify-end gap-3 pt-1">
              <Dialog.CloseButton
                data-testid="edit-message-cancel"
                class={actionClass}
                disabled={saving()}
              >
                {t("common:cancel")}
              </Dialog.CloseButton>
              <button
                data-testid="edit-message-send"
                type="submit"
                class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSubmit()}
              >
                {saving() ? t("messages:sending") : t("messages:editAndResend")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// --- Delete dialog --------------------------------------------------------

export interface DeleteMessageDialogProps {
  serverId: string;
  sessionId: string;
  messageID: string;
  onClose: () => void;
}

/** Confirms the message delete; the row stays mounted while the DELETE is
 *  in flight (deleteMessage removes the store entry only on success), so a
 *  failure surfaces as the inline error instead of a silent rollback. */
function DeleteMessageDialog(props: DeleteMessageDialogProps) {
  const t = useT();
  const { line: errorLine } = useErrorCopy();
  const [deleting, setDeleting] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);

  async function onDelete() {
    if (deleting()) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMessage(
        props.serverId,
        props.sessionId,
        props.messageID,
        createMessageService(getApiClient()),
      );
      props.onClose();
    } catch (err) {
      setError(ApiError.fromUnknown(err));
      setDeleting(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !deleting()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="delete-message-dialog"
          class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title class="text-md font-semibold">{t("messages:deleteMessage")}</Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            {t("messages:deleteMessageBody")}
          </Dialog.Description>

          <Show when={error()}>
            <p data-testid="delete-message-error" class="mt-4 text-sm text-danger">
              {errorLine(error()!)}
            </p>
          </Show>
          <div class="flex justify-end gap-3 pt-5">
            <Dialog.CloseButton
              data-testid="delete-message-cancel"
              class={actionClass}
              disabled={deleting()}
            >
              Cancel
            </Dialog.CloseButton>
            <button
              data-testid="delete-message-confirm"
              type="button"
              class="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={deleting()}
              onClick={onDelete}
            >
              {deleting() ? t("sessions:deleting") : t("common:delete")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// --- Actions root ---------------------------------------------------------

const COPY_FEEDBACK_MS = 1500;

const MessageActions: Component<MessageActionsProps> = (props) => {
  const t = useT();
  const info = () => messages[props.serverId]?.[props.sessionId]?.infos[props.messageID];
  const role = () => info()?.role ?? "assistant";
  const user = () => role() === "user";

  // Text parts of the message in render order (reactive: the store nodes
  // are read per part id).
  const textParts = createMemo<TextPart[]>(() => {
    const entry = messages[props.serverId]?.[props.sessionId];
    const out: TextPart[] = [];
    for (const id of props.partIds) {
      const part = entry?.parts[id];
      if (part?.type === "text") out.push(part);
    }
    return out;
  });

  /** Full plain text of the message (text parts joined with newlines). */
  const messageText = createMemo(() =>
    textParts()
      .map((part) => part.text ?? "")
      .join("\n"),
  );

  /** Fenced code bodies, or undefined when the message has none. */
  const codeText = createMemo(() => codeFences(messageText()));

  /** The part Edit targets: the FIRST text part of a user message. */
  const editPart = createMemo<TextPart | undefined>(() => (user() ? textParts()[0] : undefined));

  const [editOpen, setEditOpen] = createSignal(false);
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  // The shared ContextMenu state: the ⋯ trigger, the right-click (desktop)
  // and the long-press (mobile) all open the SAME menu (TASK-M8-03).
  const [contextPos, setContextPos] = createSignal<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = createSignal<"text" | "code" | null>(null);

  // The "✓ Copied" flash timer: cleared on re-flash so a rapid copy click
  // can't let a stale timer eat the newer feedback, and on unmount so the
  // row's disappearance never leaves a dangling setState.
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(copyTimer);
  });

  function flashCopy(kind: "text" | "code") {
    setCopied(kind);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => setCopied(null), COPY_FEEDBACK_MS);
  }

  async function copyText() {
    if (await copyToClipboard(messageText())) flashCopy("text");
  }

  async function copyCode() {
    const code = codeText();
    if (code !== undefined && (await copyToClipboard(code))) flashCopy("code");
  }

  const actions = createMemo<MenuItem[]>(() => [
    {
      id: "copy-text",
      label: t("messages:copyText"),
      disabled: messageText() === "",
      onSelect: () => void copyText(),
    },
    {
      id: "copy-code",
      label: t("messages:copyCode"),
      disabled: codeText() === undefined,
      onSelect: () => void copyCode(),
    },
    {
      id: "edit",
      label: t("messages:editResend"),
      disabled: editPart() === undefined,
      onSelect: () => setEditOpen(true),
    },
    {
      id: "delete",
      label: t("common:delete"),
      danger: true,
      disabled: !user(),
      onSelect: () => setDeleteOpen(true),
    },
    {
      id: "view-diff",
      label: t("messages:viewDiff"),
      disabled: props.onViewDiff === undefined,
      onSelect: () => props.onViewDiff?.(props.messageID),
    },
    {
      id: "fork",
      label: t("messages:forkFromHere"),
      disabled: props.onFork === undefined,
      onSelect: () => props.onFork?.(props.messageID),
    },
    {
      id: "revert",
      label: t("messages:revertToHere"),
      danger: true,
      disabled: props.onRevert === undefined,
      onSelect: () => props.onRevert?.(props.messageID),
    },
  ]);

  // TASK-M7-06: the touch menu keeps the copy/delete essentials only (the
  // edit dialog and the shell-side actions stay desktop paths).
  const mobileActions = createMemo<MenuItem[]>(() => {
    const allowed = new Set(["copy-text", "copy-code", "delete"]);
    return actions().filter((action) => action.id !== undefined && allowed.has(action.id));
  });
  const menuActions = () => (props.mobile ? mobileActions() : actions());

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    setContextPos({ x: event.clientX, y: event.clientY });
  }

  /** Opens the menu below the ⋯ trigger button. */
  function openTriggerMenu(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
    setContextPos({ x: rect.left, y: rect.bottom });
  }

  const triggerClass =
    "invisible absolute right-1 top-1 z-10 rounded-md px-1.5 text-sm leading-none " +
    "text-fg-secondary opacity-0 transition-opacity outline-none " +
    "group-hover:visible group-hover:opacity-100 group-focus-within:visible " +
    "group-focus-within:opacity-100 hover:bg-accent-soft hover:text-fg-primary " +
    "focus:bg-accent-soft";

  // TASK-M7-06: the mobile column long-presses open the touch menu at the
  // press position (the hook is created unconditionally, its handlers are
  // spread only in the mobile presentation).
  const longPress = useLongPress((position) => setContextPos(position));

  return (
    <div
      data-testid={`message-${props.messageID}`}
      data-role={role()}
      tabIndex={0}
      aria-haspopup="menu"
      class={`group relative flex flex-col gap-1 outline-none ${user() ? "items-end" : "items-start"}${
        props.mobile ? " [-webkit-touch-callout:none]" : ""
      }`}
      onContextMenu={handleContextMenu}
      {...(props.mobile ? longPress : {})}
    >
      {props.children}

      {/* The ⋯ trigger (TASK-M8-03): opens the shared ContextMenu below the
          button instead of the old kobalte dropdown — one item set, one
          keyboard model for the whole app. */}
      <button
        type="button"
        data-testid="message-actions"
        aria-label={t("messages:messageActions")}
        class={triggerClass}
        onClick={openTriggerMenu}
      >
        {copied() === null ? "⋯" : t("messages:copiedFlash")}
      </button>

      {/* Right-click (desktop) / long-press (mobile) / ⋯ (both): the shared
          ContextMenu at the position the menu was requested at. */}
      <Show when={contextPos() !== null}>
        <ContextMenu
          testId="message-action"
          label={t("messages:messageActions")}
          x={contextPos()!.x}
          y={contextPos()!.y}
          items={menuActions()}
          onClose={() => setContextPos(null)}
        />
      </Show>

      <Show when={editOpen() && editPart() !== undefined}>
        <EditMessageDialog
          serverId={props.serverId}
          sessionId={props.sessionId}
          messageID={props.messageID}
          part={editPart()!}
          onClose={() => setEditOpen(false)}
        />
      </Show>

      <Show when={deleteOpen()}>
        <DeleteMessageDialog
          serverId={props.serverId}
          sessionId={props.sessionId}
          messageID={props.messageID}
          onClose={() => setDeleteOpen(false)}
        />
      </Show>
    </div>
  );
};

export default MessageActions;
