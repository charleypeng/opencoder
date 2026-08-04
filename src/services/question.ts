// Question domain service (TASK-M5-02): typed wrappers around the pending
// question queue (GET /question), the reply endpoint
// (POST /question/{requestID}/reply — body { answers }, one answer array per
// question) and the reject endpoint (POST /question/{requestID}/reject, no
// body), factory form per architecture §4.4. Errors pass through as ApiError
// from the client (no catching here).

import type { components, operations } from "./api/schema.js";
import { type ApiClient, type ApiPath, type RequestOptions } from "./client.js";

export type QuestionRequest = components["schemas"]["QuestionRequest"];
export type QuestionInfo = components["schemas"]["QuestionInfo"];
export type QuestionOption = components["schemas"]["QuestionOption"];
/** One answer: the selected option labels (or the typed text) of one question. */
export type QuestionAnswer = components["schemas"]["QuestionAnswer"];
/** Request body of `POST /question/{requestID}/reply` ({ answers }). */
export type QuestionReplyInput = NonNullable<
  operations["question.reply"]["requestBody"]
>["content"]["application/json"];

function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

function replyPath(requestID: string): ApiPath {
  return `/question/${requestID}/reply` as ApiPath;
}

function rejectPath(requestID: string): ApiPath {
  return `/question/${requestID}/reject` as ApiPath;
}

export function createQuestionService(client: ApiClient) {
  return {
    /** List all pending questions (GET /question). */
    list: (dir?: string) => client.get<QuestionRequest[]>("/question", dirQuery(dir)),
    /**
     * Answer one pending request (POST /question/{requestID}/reply);
     * `answers` holds one entry per question (an array of selected option
     * labels, or the free-input text). Resolves to true on success.
     */
    reply: (requestID: string, answers: QuestionAnswer[], dir?: string) =>
      client.post<boolean>(replyPath(requestID), {
        body: { answers } satisfies QuestionReplyInput,
        ...(dirQuery(dir) ?? {}),
      }),
    /** Reject one pending request (POST /question/{requestID}/reject, no body). */
    reject: (requestID: string, dir?: string) =>
      client.post<boolean>(rejectPath(requestID), dirQuery(dir)),
  };
}

export type QuestionService = ReturnType<typeof createQuestionService>;
