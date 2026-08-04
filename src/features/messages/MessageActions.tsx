// Message actions (TASK-M3-06): per-message hover toolbar and right-click
// context menu. The "⋯" trigger is revealed on row hover (group-hover, the
// bubble column is the group) and the same item set opens on contextmenu at
// the cursor. Items:
//   - Copy text: all text parts of the message joined with newlines.
//   - Copy code: the bodies of fenced ```lang ... ``` blocks only; disabled
//     when the message has none.
//   - Edit and resend (user messages only): PATCHes the first text part with
//     the edited text, then re-prompts through the shared sendPrompt
//     pipeline (spec: PATCH + re-prompt). The dialog stays open with the
//     inline error when either leg fails.
//   - Delete (user messages only; deleting an assistant message would break
//     the server's parentID chain): confirmation dialog, optimistic removal
//     through deleteMessage with rollback on failure.
//   - View diff: placeholder until M4-07 wires the diff view; disabled while
//     no onViewDiff callback is provided.
//
// The component owns the bubble column (MessageBubble passes its body as
// children), so hover state, the context menu and the store-driven role
// alignment live in one place.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import { Dialog, DropdownMenu } from "@kobalte/core";
import { getApiClient } from "../../services/client.js";
import { ApiError, errorDetail, errorTitle } from "../../services/errors.js";
import { createMessageService } from "../../services/message.js";
import { messages, applyPartDelta } from "../../stores/messages.js";
import type { Part } from "../../stores/messages.js";
import { sendPrompt } from "../sessions/sendPrompt.js";
import { deleteMessage } from "./deleteMessage.js";

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
  /** Bubble body (bubble + timestamp). */
  children?: JSX.Element;
}

type TextPart = Extract<Part, { type: "text" }>;

interface MenuAction {
  id: string;
  label: string;
  disabled: boolean;
  danger?: boolean;
  onSelect: () => void;
}

const menuItemClass =
  "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left text-sm outline-none " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 disabled:cursor-not-allowed " +
  "disabled:opacity-50 hover:bg-accent-soft focus:bg-accent-soft data-[highlighted]:bg-accent-soft";

const menuDangerClass =
  "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left text-sm text-danger outline-none " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 disabled:cursor-not-allowed " +
  "disabled:opacity-50 hover:bg-danger/10 focus:bg-danger/10 data-[highlighted]:bg-danger/10";

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

/** "Title: detail" line; the detail is dropped when it duplicates the title. */
function errorLine(err: ApiError): string {
  const title = errorTitle(err);
  const detail = errorDetail(err);
  return detail === title ? title : `${title}: ${detail}`;
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
          <Dialog.Title class="text-md font-semibold">Edit message</Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            Edits the message and resends it as a new prompt.
          </Dialog.Description>

          <form data-testid="edit-message-form" class="mt-5 space-y-4" onSubmit={onSubmit}>
            <label class="block">
              <span class="text-sm font-medium text-fg-secondary">Message</span>
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
                Cancel
              </Dialog.CloseButton>
              <button
                data-testid="edit-message-send"
                type="submit"
                class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSubmit()}
              >
                {saving() ? "Sending…" : "Edit & resend"}
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

/** Confirms the message delete; the optimistic removal happens through
 *  deleteMessage (store rollback on failure). */
function DeleteMessageDialog(props: DeleteMessageDialogProps) {
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
          <Dialog.Title class="text-md font-semibold">Delete message</Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-fg-secondary">
            Delete this message? This cannot be undone.
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
              {deleting() ? "Deleting…" : "Delete"}
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
  const [contextPos, setContextPos] = createSignal<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = createSignal<"text" | "code" | null>(null);

  // Esc closes the hand-rolled context popover (the DropdownMenu handles
  // its own Esc).
  createEffect(() => {
    if (contextPos() === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextPos(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function flashCopy(kind: "text" | "code") {
    setCopied(kind);
    setTimeout(() => setCopied(null), COPY_FEEDBACK_MS);
  }

  async function copyText() {
    if (await copyToClipboard(messageText())) flashCopy("text");
  }

  async function copyCode() {
    const code = codeText();
    if (code !== undefined && (await copyToClipboard(code))) flashCopy("code");
  }

  const actions = createMemo<MenuAction[]>(() => [
    {
      id: "copy-text",
      label: "Copy text",
      disabled: messageText() === "",
      onSelect: () => void copyText(),
    },
    {
      id: "copy-code",
      label: "Copy code",
      disabled: codeText() === undefined,
      onSelect: () => void copyCode(),
    },
    {
      id: "edit",
      label: "Edit and resend",
      disabled: editPart() === undefined,
      onSelect: () => setEditOpen(true),
    },
    {
      id: "delete",
      label: "Delete",
      danger: true,
      disabled: !user(),
      onSelect: () => setDeleteOpen(true),
    },
    {
      id: "view-diff",
      label: "View diff",
      disabled: props.onViewDiff === undefined,
      onSelect: () => props.onViewDiff?.(props.messageID),
    },
  ]);

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    setContextPos({ x: event.clientX, y: event.clientY });
  }

  const triggerClass =
    "invisible absolute right-1 top-1 z-10 rounded-md px-1.5 text-sm leading-none " +
    "text-fg-secondary opacity-0 transition-opacity outline-none " +
    "group-hover:visible group-hover:opacity-100 group-focus-within:visible " +
    "group-focus-within:opacity-100 hover:bg-accent-soft hover:text-fg-primary " +
    "focus:bg-accent-soft";

  return (
    <div
      data-testid={`message-${props.messageID}`}
      data-role={role()}
      class={`group relative flex flex-col gap-1 ${user() ? "items-end" : "items-start"}`}
      onContextMenu={handleContextMenu}
    >
      {props.children}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          as="button"
          type="button"
          data-testid="message-actions"
          aria-label="Message actions"
          class={triggerClass}
        >
          {copied() === null ? "⋯" : "✓ Copied"}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="glass z-50 min-w-44 p-1">
            <For each={actions()}>
              {(action) => (
                <DropdownMenu.Item
                  data-testid={`message-action-${action.id}`}
                  class={action.danger ? menuDangerClass : menuItemClass}
                  disabled={action.disabled}
                  onSelect={action.onSelect}
                >
                  {action.label}
                </DropdownMenu.Item>
              )}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Right-click popover: fixed at the cursor, same item set. */}
      <Show when={contextPos() !== null}>
        <div
          data-testid="message-context-backdrop"
          class="fixed inset-0 z-40"
          onContextMenu={(event) => event.preventDefault()}
          onClick={() => setContextPos(null)}
        />
        <div
          data-testid="message-context-menu"
          class="glass fixed z-50 min-w-44 p-1"
          style={{
            left: `${Math.min(contextPos()!.x, window.innerWidth - 200)}px`,
            top: `${Math.min(contextPos()!.y, window.innerHeight - 200)}px`,
          }}
        >
          <For each={actions()}>
            {(action) => (
              <button
                data-testid={`message-context-${action.id}`}
                type="button"
                class={action.danger ? menuDangerClass : menuItemClass}
                disabled={action.disabled}
                onClick={() => {
                  setContextPos(null);
                  action.onSelect();
                }}
              >
                {action.label}
              </button>
            )}
          </For>
        </div>
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
