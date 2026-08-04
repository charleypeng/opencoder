// Question store (TASK-M5-02): per-server queue of pending question requests
// (architecture.md §5), fed by the `question.asked` SSE event (enqueue,
// deduped by id) and the initial GET /question list (applyList), drained by
// `question.replied` / `question.rejected` events and the sheet's own reply /
// reject POST (dequeue by id — all paths are idempotent). `version` bumps on
// every change so mounted question sheets always see the latest queue head.

import { createStore, produce } from "solid-js/store";
import type { QuestionRequest } from "../services/question.js";

export interface QuestionServerState {
  /** Pending requests in arrival order; the head is shown to the user. */
  queue: QuestionRequest[];
  /** Bumped on every queue change; drives the sheet's re-render. */
  version: number;
}

export type QuestionMap = Record<string, QuestionServerState>;

const [questions, setQuestions] = createStore<QuestionMap>({});

/** Reactive per-server question queue state (bucket absent until the first event). */
export { questions };

/** Non-reactive read of one server's question queue state. */
export function getServerQuestionState(serverId: string): QuestionServerState | undefined {
  return questions[serverId];
}

/** Enqueues a pending request; duplicate ids are ignored (idempotent). */
export function enqueue(serverId: string, request: QuestionRequest): void {
  if (request === null || typeof request !== "object" || typeof request.id !== "string") return;
  setQuestions(
    produce((draft) => {
      const server = draft[serverId] ?? { queue: [], version: 0 };
      if (server.queue.some((existing) => existing.id === request.id)) return;
      server.queue = [...server.queue, request];
      server.version += 1;
      draft[serverId] = server;
    }),
  );
}

/** Removes a request from the queue (reply/reject success, replied/rejected). */
export function dequeue(serverId: string, requestId: string): void {
  if (typeof requestId !== "string") return;
  setQuestions(
    produce((draft) => {
      const server = draft[serverId];
      if (server === undefined) return;
      const next = server.queue.filter((request) => request.id !== requestId);
      if (next.length === server.queue.length) return;
      server.queue = next;
      server.version += 1;
      draft[serverId] = server;
    }),
  );
}

/** Replaces the whole queue from GET /question (initial fetch / re-sync). */
export function applyList(serverId: string, requests: QuestionRequest[]): void {
  if (!Array.isArray(requests)) return;
  setQuestions(
    produce((draft) => {
      const server = draft[serverId] ?? { queue: [], version: 0 };
      server.queue = [...requests];
      server.version += 1;
      draft[serverId] = server;
    }),
  );
}

/** Clears a server's queue (drop before full re-sync / context rebuild). */
export function resetServer(serverId: string): void {
  setQuestions(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}
