// Global agent question sheet (TASK-M5-02, architecture.md §7.2): mounted
// once per workspace (DesktopShell overlay, MobileShell bottom sheet —
// TASK-M7-05), it reads the per-server question queue (stores/question.ts)
// and shows the queue head — the question header chip, the full question
// text and one of two answer forms: option buttons (each option replies
// with its label) or a free-input textarea with a Send button — plus a
// Reject action posting to POST /question/{requestID}/reject. A request is
// dequeued only after its reply/reject POST succeeds (a failure keeps it
// queued — the requeue — and shows an inline error; the controls are
// disabled while one POST is in flight). `question.replied` /
// `question.rejected` events dequeue independently (idempotent, routed in
// stores/events.ts). A "1 of N" indicator shows the queue position when
// more than one request is pending. The card cannot be dismissed (no close
// button / Esc / scrim / drag): a question must be answered, not skipped —
// the sheet variant pins the Sheet's `dismissible` to false. A request
// whose head carries no questions (malformed server payload) renders
// defensively with the Reject action only. Timeout / already-answered
// states are covered defensively: an answered question is dropped by its
// replied/rejected event (a reply racing an already-settled request fails
// with the inline error and the event clears the queue), and the 1.18.11
// contract has no question timeout event, so nothing else is needed.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { Dialog } from "@kobalte/core";
import Sheet from "../../components/Sheet.js";
import { getApiClient } from "../../services/client.js";
import { ApiError, errorTitle } from "../../services/errors.js";
import { createQuestionService, type QuestionRequest } from "../../services/question.js";
import { dequeue, questions } from "../../stores/question.js";

export interface QuestionSheetProps {
  /** The server whose question queue is shown. */
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

interface QuestionCardProps {
  /** The head question (undefined for a malformed request without one). */
  question: QuestionRequest["questions"][number] | undefined;
  /** Queue length (drives the "1 of N" indicator). */
  count: number;
  replying: boolean;
  error: ApiError | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onOption: (label: string) => void;
  onSend: () => void;
  onReject: () => void;
}

/** The shared card body — used by both the overlay dialog and the mobile
 *  bottom sheet, so the answer forms render identically everywhere. */
function QuestionCard(props: QuestionCardProps) {
  const hasOptions = () => (props.question?.options.length ?? 0) > 0;
  return (
    <>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <Show when={props.count > 1}>
            <p data-testid="question-queue-position" class="mt-0.5 text-xs text-fg-faint">
              1 of {props.count} waiting
            </p>
          </Show>
        </div>
        <Show when={props.question}>
          <span
            data-testid="question-header"
            class="shrink-0 rounded-full border border-accent bg-accent-soft px-3 py-1 font-code text-xs text-accent"
          >
            {props.question!.header}
          </span>
        </Show>
      </div>

      <Show when={props.question} fallback={null}>
        <p data-testid="question-text" class="mt-3 text-sm text-fg-default">
          {props.question!.question}
        </p>
      </Show>

      {/* Defensive render: a request without questions (malformed
            server payload) cannot be answered — show the note and
            keep the Reject action so it can still be settled. */}
      <Show when={!props.question}>
        <p data-testid="question-unavailable" class="mt-3 text-sm text-fg-faint">
          Question content unavailable.
        </p>
      </Show>

      <Show when={props.question && hasOptions()}>
        <div data-testid="question-options" class="mt-4 flex flex-col gap-2">
          <For each={props.question!.options}>
            {(option) => (
              <button
                type="button"
                data-testid="question-option"
                class="rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 text-left text-sm text-fg-default outline-none transition-colors hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
                disabled={props.replying}
                onClick={() => props.onOption(option.label)}
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

      <Show when={props.question && !hasOptions()}>
        <textarea
          data-testid="question-free-input"
          class="mt-4 w-full resize-none rounded-md border border-bg-sunken bg-bg-sunken px-3 py-2 text-sm text-fg-default outline-none placeholder:text-fg-faint focus:border-accent"
          rows={3}
          placeholder="Type your answer…"
          value={props.draft}
          disabled={props.replying}
          onInput={(event) => props.onDraftChange(event.currentTarget.value)}
        />
      </Show>

      <Show when={props.error}>
        <p data-testid="question-error" class="mt-3 text-sm text-danger">
          {errorTitle(props.error!)} — the question stays queued; retry below.
        </p>
      </Show>

      <div class="mt-5 flex flex-wrap justify-end gap-2">
        <Show when={props.question && !hasOptions()}>
          <button
            type="button"
            data-testid="question-send"
            class={actionButtonClass("accent")}
            disabled={props.replying || props.draft.trim() === ""}
            onClick={() => props.onSend()}
          >
            Send
          </button>
        </Show>
        <button
          type="button"
          data-testid="question-reject"
          class={actionButtonClass("danger")}
          disabled={props.replying}
          onClick={() => props.onReject()}
        >
          Reject
        </button>
      </div>
    </>
  );
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
    <>
      {/* Desktop overlay: the classic centered dialog (cannot be dismissed). */}
      <Dialog.Root open={props.variant === "overlay" && head() !== undefined}>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content
            data-testid="question-sheet"
            class="glass fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-6"
            onEscapeKeyDown={(event) => event.preventDefault()}
          >
            <Show when={head() !== undefined}>
              <Dialog.Title class="text-md font-semibold">Question</Dialog.Title>
              <QuestionCard
                question={question()}
                count={count()}
                replying={replying()}
                error={error()}
                draft={draft()}
                onDraftChange={(value) => setDraft(value)}
                onOption={onOption}
                onSend={onSend}
                onReject={onReject}
              />
            </Show>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Mobile bottom sheet (TASK-M7-05): the same card inside the Sheet;
          pinned (dismissible=false) — a question must be answered. */}
      <Sheet
        open={props.variant === "sheet" && head() !== undefined}
        onClose={() => undefined}
        snap="high"
        title="Question"
        testId="question-sheet"
        dismissible={false}
      >
        <QuestionCard
          question={question()}
          count={count()}
          replying={replying()}
          error={error()}
          draft={draft()}
          onDraftChange={(value) => setDraft(value)}
          onOption={onOption}
          onSend={onSend}
          onReject={onReject}
        />
      </Sheet>
    </>
  );
};

export default QuestionSheet;
