// Global permission request sheet (TASK-M5-01, architecture.md §7.2):
// mounted once per workspace in DesktopShell, it reads the per-server
// permission queue (stores/permission.ts) and shows a kobalte overlay for
// the queue head — permission type, pattern chips, tool context
// (messageID/callID) and an expandable metadata detail — with the three
// reply actions (Allow once / Always allow / Reject) posting to
// POST /permission/{requestID}/reply. A request is dequeued only after its
// reply POST succeeds (a failure keeps it queued — the requeue — and shows
// an inline error; the reply buttons are disabled while one POST is in
// flight). `permission.replied` events dequeue independently (idempotent,
// routed in stores/events.ts). "Always allow" also records the pattern in
// the session remember-memo, and a remembered pattern arriving later is
// auto-replied "always" silently — the card stays hidden while that reply
// is in flight and appears (with the inline error) if it fails, so nothing
// is ever dropped silently. A "1 of N" indicator shows the queue position
// when more than one request is pending. The dialog cannot be dismissed
// (no close button / Esc / overlay): a permission must be answered, not
// skipped. The `variant` prop reserves the M7 mobile bottom sheet; only
// "overlay" renders today.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { getApiClient } from "../../services/client.js";
import { ApiError, errorTitle } from "../../services/errors.js";
import { createPermissionService, type PermissionReply } from "../../services/permission.js";
import type { PermissionRequest } from "../../services/permission.js";
import { dequeue, permissions } from "../../stores/permission.js";
import { isPatternRemembered, rememberPattern } from "./remembered.js";

export interface PermissionSheetProps {
  /** The server whose permission queue is shown. */
  serverId: string;
  /** "overlay" = desktop dialog; "sheet" = M7 mobile bottom sheet (no-op). */
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
  // a manual retry.
  createEffect(() => {
    if (props.variant !== "overlay") return;
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

  return (
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
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <Dialog.Title class="text-md font-semibold">Permission request</Dialog.Title>
                    <Show when={count() > 1}>
                      <p
                        data-testid="permission-queue-position"
                        class="mt-0.5 text-xs text-fg-faint"
                      >
                        1 of {count()} waiting
                      </p>
                    </Show>
                  </div>
                  <span
                    data-testid="permission-type"
                    class="shrink-0 rounded-full border border-accent bg-accent-soft px-3 py-1 font-code text-xs text-accent"
                  >
                    {request().permission}
                  </span>
                </div>

                <Show when={request().patterns.length > 0}>
                  <div data-testid="permission-patterns" class="mt-3 flex flex-wrap gap-1.5">
                    <For each={request().patterns}>
                      {(pattern) => (
                        <code class="rounded border border-bg-sunken bg-bg-sunken px-2 py-0.5 font-code text-xs text-fg-default">
                          {pattern}
                        </code>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={request().tool}>
                  <p
                    data-testid="permission-tool-context"
                    class="mt-3 font-code text-xs text-fg-faint"
                  >
                    message {request().tool?.messageID} · call {request().tool?.callID}
                  </p>
                </Show>

                <Show when={Object.keys(request().metadata).length > 0}>
                  <div class="mt-3">
                    <button
                      type="button"
                      data-testid="permission-details-toggle"
                      aria-expanded={detailsOpen() ? "true" : "false"}
                      class="text-xs font-medium text-fg-secondary outline-none hover:text-fg-primary"
                      onClick={() => setDetailsOpen((open) => !open)}
                    >
                      {detailsOpen() ? "Hide details" : "Show details"}
                    </button>
                    <Show when={detailsOpen()}>
                      <pre
                        data-testid="permission-details"
                        class="mt-1.5 max-h-40 overflow-auto rounded-md border border-bg-sunken bg-bg-sunken p-2.5 font-code text-xs text-fg-secondary"
                      >
                        {JSON.stringify(request().metadata, null, 2)}
                      </pre>
                    </Show>
                  </div>
                </Show>

                <Show when={error()}>
                  <p data-testid="permission-error" class="mt-3 text-sm text-danger">
                    {errorTitle(error()!)} — the request stays queued; retry below.
                  </p>
                </Show>

                <div class="mt-5 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    data-testid="permission-allow-once"
                    class={actionButtonClass("neutral")}
                    disabled={replying()}
                    onClick={() => onAction(request(), "once")}
                  >
                    Allow once
                  </button>
                  <button
                    type="button"
                    data-testid="permission-allow-always"
                    class={actionButtonClass("accent")}
                    disabled={replying()}
                    onClick={() => onAction(request(), "always")}
                  >
                    Always allow
                  </button>
                  <button
                    type="button"
                    data-testid="permission-reject"
                    class={actionButtonClass("danger")}
                    disabled={replying()}
                    onClick={() => onAction(request(), "reject")}
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
          </Show>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default PermissionSheet;
