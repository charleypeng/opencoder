// Global permission request sheet (TASK-M5-01, architecture.md §7.2):
// mounted once per workspace (DesktopShell overlay, MobileShell bottom
// sheet — TASK-M7-05), it reads the per-server permission queue
// (stores/permission.ts) and shows the queue head — permission type,
// pattern chips, tool context (messageID/callID) and an expandable
// metadata detail — with the three reply actions (Allow once / Always
// allow / Reject) posting to POST /permission/{requestID}/reply. A
// request is dequeued only after its reply POST succeeds (a failure
// keeps it queued — the requeue — and shows an inline error; the reply
// buttons are disabled while one POST is in flight). `permission.replied`
// events dequeue independently (idempotent, routed in stores/events.ts).
// "Always allow" also records the pattern in the session remember-memo,
// and a remembered pattern arriving later is auto-replied "always"
// silently — the card stays hidden while that reply is in flight and
// appears (with the inline error) if it fails, so nothing is ever dropped
// silently. A "1 of N" indicator shows the queue position when more than
// one request is pending. The card cannot be dismissed (no close button /
// Esc / scrim / drag): a permission must be answered, not skipped — the
// sheet variant pins the Sheet's `dismissible` to false.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import Sheet from "../../components/Sheet.js";
import { getApiClient } from "../../services/client.js";
import { ApiError, errorTitle } from "../../services/errors.js";
import { createPermissionService, type PermissionReply } from "../../services/permission.js";
import type { PermissionRequest } from "../../services/permission.js";
import { dequeue, permissions } from "../../stores/permission.js";
import { registerSheet } from "../../stores/sheets.js";
import { isPatternRemembered, rememberPattern } from "./remembered.js";

export interface PermissionSheetProps {
  /** The server whose permission queue is shown. */
  serverId: string;
  /** "overlay" = desktop dialog; "sheet" = M7 mobile bottom sheet. */
  variant: "overlay" | "sheet";
}

function actionButtonClass(kind: "accent" | "danger" | "neutral"): string {
  const base =
    "rounded-md px-4 py-2 text-sm font-medium outline-none transition-colors " +
    "disabled:cursor-not-allowed disabled:opacity-50";
  switch (kind) {
    case "accent":
      return `${base} bg-accent text-white hover:brightness-105`;
    case "danger":
      return `${base} border border-danger/40 bg-bg-sunken text-danger hover:bg-danger/10`;
    default:
      return `${base} border border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary`;
  }
}

interface PermissionCardProps {
  /** The queue head shown by the card. */
  request: PermissionRequest;
  /** Queue length (drives the "1 of N" indicator). */
  count: number;
  replying: boolean;
  error: ApiError | null;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onAction: (reply: PermissionReply) => void;
}

/** The shared card body — used by both the overlay dialog and the mobile
 *  bottom sheet, so the reply logic renders identically everywhere. */
function PermissionCard(props: PermissionCardProps) {
  return (
    <>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <Show when={props.count > 1}>
            <p data-testid="permission-queue-position" class="mt-0.5 text-xs text-fg-faint">
              1 of {props.count} waiting
            </p>
          </Show>
        </div>
        <span
          data-testid="permission-type"
          class="shrink-0 rounded-full border border-accent bg-accent-soft px-3 py-1 font-code text-xs text-accent"
        >
          {props.request.permission}
        </span>
      </div>

      <Show when={props.request.patterns.length > 0}>
        <div data-testid="permission-patterns" class="mt-3 flex flex-wrap gap-1.5">
          <For each={props.request.patterns}>
            {(pattern) => (
              <code class="rounded border border-bg-sunken bg-bg-sunken px-2 py-0.5 font-code text-xs text-fg-default">
                {pattern}
              </code>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.request.tool}>
        <p data-testid="permission-tool-context" class="mt-3 font-code text-xs text-fg-faint">
          message {props.request.tool?.messageID} · call {props.request.tool?.callID}
        </p>
      </Show>

      <Show when={Object.keys(props.request.metadata).length > 0}>
        <div class="mt-3">
          <button
            type="button"
            data-testid="permission-details-toggle"
            aria-expanded={props.detailsOpen ? "true" : "false"}
            class="text-xs font-medium text-fg-secondary outline-none hover:text-fg-primary"
            onClick={() => props.onToggleDetails()}
          >
            {props.detailsOpen ? "Hide details" : "Show details"}
          </button>
          <Show when={props.detailsOpen}>
            <pre
              data-testid="permission-details"
              class="mt-1.5 max-h-40 overflow-auto rounded-md border border-bg-sunken bg-bg-sunken p-2.5 font-code text-xs text-fg-secondary"
            >
              {JSON.stringify(props.request.metadata, null, 2)}
            </pre>
          </Show>
        </div>
      </Show>

      <Show when={props.error}>
        <p data-testid="permission-error" class="mt-3 text-sm text-danger">
          {errorTitle(props.error!)} — the request stays queued; retry below.
        </p>
      </Show>

      <div class="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          data-testid="permission-allow-once"
          class={actionButtonClass("neutral")}
          disabled={props.replying}
          onClick={() => props.onAction("once")}
        >
          Allow once
        </button>
        <button
          type="button"
          data-testid="permission-allow-always"
          class={actionButtonClass("accent")}
          disabled={props.replying}
          onClick={() => props.onAction("always")}
        >
          Always allow
        </button>
        <button
          type="button"
          data-testid="permission-reject"
          class={actionButtonClass("danger")}
          disabled={props.replying}
          onClick={() => props.onAction("reject")}
        >
          Reject
        </button>
      </div>
    </>
  );
}

const PermissionSheet: Component<PermissionSheetProps> = (props) => {
  // TODO(M8-06): native system notification + pending-count badge on
  // enqueue (tauri-plugin-notification + set_badge command, architecture
  // §7.2). The sheet itself is the alert for now.
  // One reply at a time: the buttons lock while a POST is in flight.
  const [replying, setReplying] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  // Auto-reply bookkeeping: the id whose silent "always" reply is in
  // flight (card hidden meanwhile) and the ids already auto-replied
  // (failed attempts stay visible for manual retry, never re-attempted).
  const [autoReplyId, setAutoReplyId] = createSignal<string | null>(null);
  const autoReplyAttempted = new Set<string>();

  const queue = createMemo(() => permissions[props.serverId]?.queue ?? []);
  const head = (): PermissionRequest | undefined => queue()[0];
  const count = () => queue().length;

  // The request shown to the user: the queue head, hidden only while its
  // silent auto-reply is in flight.
  const visible = createMemo(() => {
    const request = head();
    if (request === undefined) return undefined;
    if (autoReplyId() === request.id) return undefined;
    return request;
  });

  // Auto-reply: a remembered pattern is answered "always" without showing
  // the card. A failed attempt surfaces the card with the inline error for
  // a manual retry. Runs in both variants (TASK-M7-05 wired the sheet).
  createEffect(() => {
    const request = head();
    if (request === undefined || replying()) return;
    if (!isPatternRemembered(props.serverId, request)) return;
    if (autoReplyAttempted.has(request.id)) return;
    autoReplyAttempted.add(request.id);
    setAutoReplyId(request.id);
    void replyTo(request, "always").finally(() => setAutoReplyId(null));
  });

  async function replyTo(request: PermissionRequest, reply: PermissionReply): Promise<void> {
    setReplying(true);
    setError(null);
    try {
      await createPermissionService(getApiClient()).reply(request.id, reply);
      if (reply === "always") rememberPattern(props.serverId, request);
      // Success drains the queue; a failure keeps the request queued (the
      // requeue) so the user can retry any action.
      dequeue(props.serverId, request.id);
    } catch (err) {
      // A failed auto-reply also surfaces the card with the error (via the
      // visible memo) so the request is never dropped silently.
      setError(ApiError.fromUnknown(err));
    } finally {
      setReplying(false);
    }
  }

  function onAction(request: PermissionRequest, reply: PermissionReply): void {
    if (replying()) return;
    void replyTo(request, reply);
  }

  // TASK-M7-10: register the open sheet with the Android system back
  // resolver (stores/sheets.ts). Pinned — the back key NEVER closes it
  // (a permission must be answered, not skipped), but the entry matters:
  // the resolver treats a pinned sheet as blocking, so back neither pops
  // the route underneath nor swallows the press (native default resumes).
  createEffect(() => {
    const open = props.variant === "sheet" && visible() !== undefined;
    registerSheet(
      "permission",
      open ? { id: "permission", dismissible: false, close: () => undefined } : null,
    );
    onCleanup(() => registerSheet("permission", null));
  });

  const card = (request: PermissionRequest) => (
    <PermissionCard
      request={request}
      count={count()}
      replying={replying()}
      error={error()}
      detailsOpen={detailsOpen()}
      onToggleDetails={() => setDetailsOpen((open) => !open)}
      onAction={(reply) => onAction(request, reply)}
    />
  );

  return (
    <>
      {/* Desktop overlay: the classic centered dialog (cannot be dismissed). */}
      <Dialog.Root open={props.variant === "overlay" && visible() !== undefined}>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content
            data-testid="permission-sheet"
            class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-6"
            onEscapeKeyDown={(event) => event.preventDefault()}
          >
            <Show when={visible()} fallback={null}>
              {(request) => (
                <>
                  <Dialog.Title class="text-md font-semibold">Permission request</Dialog.Title>
                  {card(request())}
                </>
              )}
            </Show>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Mobile bottom sheet (TASK-M7-05): the same card inside the Sheet;
          pinned (dismissible=false) — a permission must be answered. */}
      <Sheet
        open={props.variant === "sheet" && visible() !== undefined}
        onClose={() => undefined}
        snap="high"
        title="Permission request"
        testId="permission-sheet"
        dismissible={false}
      >
        <Show when={visible()} fallback={null}>
          {(request) => card(request())}
        </Show>
      </Sheet>
    </>
  );
};

export default PermissionSheet;
