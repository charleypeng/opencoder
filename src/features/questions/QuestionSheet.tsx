// Global agent question sheet (TASK-M5-02, architecture.md §7.2): mounted
// once per workspace in DesktopShell, it reads the per-server question
// queue (stores/question.ts) and shows a kobalte overlay for the queue head
// — the question header chip, the full question text and one of two answer
// forms: option buttons (each option replies with its label) or a free-input
// textarea with a Send button — plus a Reject action posting to
// POST /question/{requestID}/reject. A request is dequeued only after its
// reply/reject POST succeeds (a failure keeps it queued — the requeue — and
// shows an inline error; the controls are disabled while one POST is in
// flight). `question.replied` / `question.rejected` events dequeue
// independently (idempotent, routed in stores/events.ts). A "1 of N"
// indicator shows the queue position when more than one request is pending.
// The dialog cannot be dismissed (no close button / Esc / overlay): a
// question must be answered, not skipped. A request whose head carries no
// questions (malformed server payload) renders defensively with the Reject
// action only. Timeout / already-answered states are covered defensively: an
// answered question is dropped by its replied/rejected event (a reply racing
// an already-settled request fails with the inline error and the event
// clears the queue), and the 1.18.11 contract has no question timeout event,
// so nothing else is needed. The `variant` prop reserves the M7 mobile
// bottom sheet; only "overlay" renders today.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import { getApiClient } from "../../services/client.js";
import { ApiError, errorTitle } from "../../services/errors.js";
import { createQuestionService, type QuestionRequest } from "../../services/question.js";
import { dequeue, questions } from "../../stores/question.js";

export interface QuestionSheetProps {
  /** The server whose question queue is shown. */
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

const QuestionSheet: Component<QuestionSheetProps> = (props) => {
  // TODO(M8-06): native system notification + pending-count badge on
  // enqueue (shared with the permission sheet, architecture §7.2). The
  // sheet itself is the alert for now.
  // One reply at a time: the controls lock while a POST is in flight.
  const [replying, setReplying] = createSignal(false);
  const [error, setError] = createSignal<ApiError | null>(null);
  const [draft, setDraft] = createSignal("");

  const queue = createMemo(() => questions[props.serverId]?.queue ?? []);
  const head = (): QuestionRequest | undefined => queue()[0];
  const count = () => queue().length;
  // The question shown to the user: the first question of the queue head.
  // Requests carry a `questions` array; recorded fixtures and the mock
  // scenario always use a single question per request, so the sheet answers
  // the head question only (multi-question requests are out of M5 scope).
  const question = createMemo(() => head()?.questions[0]);
  const hasOptions = () => (question()?.options.length ?? 0) > 0;

  async function submit(answers: string[][]): Promise<void> {
    const request = head();
    if (request === undefined || replying()) return;
    setReplying(true);
    setError(null);
    try {
      await createQuestionService(getApiClient()).reply(request.id, answers);
      // Success drains the queue; a failure keeps the request queued (the
      // requeue) so the user can retry any action. If the request was
      // already settled server-side, its replied/rejected event drains the
      // queue independently of this error path.
      dequeue(props.serverId, request.id);
      setDraft("");
    } catch (err) {
      setError(ApiError.fromUnknown(err));
    } finally {
      setReplying(false);
    }
  }

  function onOption(label: string): void {
    if (replying()) return;
    void submit([[label]]);
  }

  async function rejectTo(request: QuestionRequest): Promise<void> {
    setReplying(true);
    setError(null);
    try {
      await createQuestionService(getApiClient()).reject(request.id);
      dequeue(props.serverId, request.id);
    } catch (err) {
      setError(ApiError.fromUnknown(err));
    } finally {
      setReplying(false);
    }
  }

  function onReject(): void {
    const request = head();
    if (request === undefined || replying()) return;
    void rejectTo(request);
  }

  function onSend(): void {
    if (replying()) return;
    const text = draft().trim();
    if (text === "") return;
    void submit([[text]]);
  }

  // Clear the draft when the head question changes (e.g. the previous
  // request was answered elsewhere and the next one shows up).
  createEffect(() => {
    void question();
    setDraft("");
  });

  return (
    <Dialog.Root open={props.variant === "overlay" && head() !== undefined}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          data-testid="question-sheet"
          class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-6"
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <Show when={head() !== undefined}>
            <>
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <Dialog.Title class="text-md font-semibold">Question</Dialog.Title>
                  <Show when={count() > 1}>
                    <p data-testid="question-queue-position" class="mt-0.5 text-xs text-fg-faint">
                      1 of {count()} waiting
                    </p>
                  </Show>
                </div>
                <Show when={question()}>
                  <span
                    data-testid="question-header"
                    class="shrink-0 rounded-full border border-accent bg-accent-soft px-3 py-1 font-code text-xs text-accent"
                  >
                    {question()!.header}
                  </span>
                </Show>
              </div>

              <Show when={question()} fallback={null}>
                <p data-testid="question-text" class="mt-3 text-sm text-fg-default">
                  {question()!.question}
                </p>
              </Show>

              {/* Defensive render: a request without questions (malformed
                    server payload) cannot be answered — show the note and
                    keep the Reject action so it can still be settled. */}
              <Show when={!question()}>
                <p data-testid="question-unavailable" class="mt-3 text-sm text-fg-faint">
                  Question content unavailable.
                </p>
              </Show>

              <Show when={question() && hasOptions()}>
                <div data-testid="question-options" class="mt-4 flex flex-col gap-2">
                  <For each={question()!.options}>
                    {(option) => (
                      <button
                        type="button"
                        data-testid="question-option"
                        class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 text-left text-sm text-fg-default outline-none transition-colors hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={replying()}
                        onClick={() => onOption(option.label)}
                      >
                        <span class="block font-medium">{option.label}</span>
                        <Show when={option.description}>
                          <span class="block text-xs text-fg-faint">{option.description}</span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={question() && !hasOptions()}>
                <textarea
                  data-testid="question-free-input"
                  class="mt-4 w-full resize-none rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 text-sm text-fg-default outline-none placeholder:text-fg-faint focus:border-accent"
                  rows={3}
                  placeholder="Type your answer…"
                  value={draft()}
                  disabled={replying()}
                  onInput={(event) => setDraft(event.currentTarget.value)}
                />
              </Show>

              <Show when={error()}>
                <p data-testid="question-error" class="mt-3 text-sm text-danger">
                  {errorTitle(error()!)} — the question stays queued; retry below.
                </p>
              </Show>

              <div class="mt-5 flex flex-wrap justify-end gap-2">
                <Show when={question() && !hasOptions()}>
                  <button
                    type="button"
                    data-testid="question-send"
                    class={actionButtonClass("accent")}
                    disabled={replying() || draft().trim() === ""}
                    onClick={onSend}
                  >
                    Send
                  </button>
                </Show>
                <button
                  type="button"
                  data-testid="question-reject"
                  class={actionButtonClass("danger")}
                  disabled={replying()}
                  onClick={onReject}
                >
                  Reject
                </button>
              </div>
            </>
          </Show>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default QuestionSheet;
