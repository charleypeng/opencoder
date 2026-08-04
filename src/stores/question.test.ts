// L1 tests for the question store (TASK-M5-02): enqueue appends and
// dedupes by id, dequeue removes only the targeted request, applyList
// replaces the queue wholesale, resetServer clears the bucket, and every
// change bumps the version while per-server buckets stay isolated.

import { afterEach, describe, expect, it } from "vitest";
import { applyList, dequeue, enqueue, questions, resetServer } from "./question.js";
import type { QuestionRequest } from "../services/question.js";

const SERVER = "srv-que";
const OTHER = "srv-other";

function request(id: string, question = "Which approach?"): QuestionRequest {
  return {
    id,
    sessionID: "ses_1",
    questions: [
      {
        question,
        header: "Approach",
        options: [
          { label: "Incremental", description: "Small steps" },
          { label: "Big bang", description: "One pass" },
        ],
      },
    ],
  };
}

afterEach(() => {
  resetServer(SERVER);
  resetServer(OTHER);
});

describe("question store", () => {
  it("enqueue appends the request and bumps the version", () => {
    enqueue(SERVER, request("que_1"));
    expect(questions[SERVER].queue).toEqual([request("que_1")]);
    expect(questions[SERVER].version).toBe(1);

    enqueue(SERVER, request("que_2", "Any preference?"));
    expect(questions[SERVER].queue.map((r) => r.id)).toEqual(["que_1", "que_2"]);
    expect(questions[SERVER].version).toBe(2);
  });

  it("enqueue ignores duplicate ids (idempotent)", () => {
    enqueue(SERVER, request("que_1"));
    enqueue(SERVER, request("que_1", "Any preference?"));
    expect(questions[SERVER].queue).toEqual([request("que_1")]);
    expect(questions[SERVER].version).toBe(1);
  });

  it("enqueue ignores malformed requests", () => {
    enqueue(SERVER, null as unknown as QuestionRequest);
    enqueue(SERVER, { sessionID: "ses_1", questions: [] } as unknown as QuestionRequest);
    expect(questions[SERVER]).toBeUndefined();
  });

  it("dequeue removes the request and advances the queue head", () => {
    enqueue(SERVER, request("que_1"));
    enqueue(SERVER, request("que_2"));
    dequeue(SERVER, "que_1");
    expect(questions[SERVER].queue).toEqual([request("que_2")]);
    expect(questions[SERVER].version).toBe(3);
  });

  it("dequeue of an unknown id is a no-op (no version bump)", () => {
    enqueue(SERVER, request("que_1"));
    const version = questions[SERVER].version;
    dequeue(SERVER, "que_nope");
    expect(questions[SERVER].queue.map((r) => r.id)).toEqual(["que_1"]);
    expect(questions[SERVER].version).toBe(version);
    dequeue(SERVER, 7 as unknown as string);
    expect(questions[SERVER].version).toBe(version);
  });

  it("applyList replaces the whole queue", () => {
    enqueue(SERVER, request("que_1"));
    applyList(SERVER, [request("que_a"), request("que_b", "Free input?")]);
    expect(questions[SERVER].queue.map((r) => r.id)).toEqual(["que_a", "que_b"]);
    applyList(SERVER, []);
    expect(questions[SERVER].queue).toEqual([]);
  });

  it("applyList ignores non-array payloads", () => {
    enqueue(SERVER, request("que_1"));
    applyList(SERVER, null as unknown as QuestionRequest[]);
    expect(questions[SERVER].queue.map((r) => r.id)).toEqual(["que_1"]);
  });

  it("resetServer clears the bucket entirely", () => {
    enqueue(SERVER, request("que_1"));
    resetServer(SERVER);
    expect(questions[SERVER]).toBeUndefined();
  });

  it("keeps per-server buckets isolated", () => {
    enqueue(SERVER, request("que_1"));
    enqueue(OTHER, request("que_x"));
    expect(questions[SERVER].queue.map((r) => r.id)).toEqual(["que_1"]);
    expect(questions[OTHER].queue.map((r) => r.id)).toEqual(["que_x"]);
    dequeue(SERVER, "que_1");
    expect(questions[OTHER].queue.map((r) => r.id)).toEqual(["que_x"]);
  });
});
