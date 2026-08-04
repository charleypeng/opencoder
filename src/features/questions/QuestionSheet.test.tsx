// L2 tests for the question sheet (TASK-M5-02): renders the queue head
// (header chip, question text, tool context is not shown — the question
// text is the content) with either an options form (one button per option,
// click replies with that option's label) or a free-input form (textarea +
// Send, disabled while empty); Reject posts to the reject endpoint; both
// paths drain the queue only on success — a failure keeps the request
// queued (requeue) and shows an inline error; the controls lock while a
// POST is in flight; a "1 of N" indicator shows the queue position and a
// store-level dequeue (question.replied / question.rejected event path)
// advances the head; a malformed request without questions renders
// defensively (note + Reject only); Esc cannot dismiss the dialog; the
// "sheet" variant renders nothing (M7).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { enqueue, dequeue, resetServer as resetQuestionStore } from "../../stores/question";
import type { QuestionRequest } from "../../services/question";
import QuestionSheet from "./QuestionSheet";

const { createQuestionServiceMock, getApiClientMock } = vi.hoisted(() => ({
  createQuestionServiceMock: vi.fn(),
  getApiClientMock: vi.fn(),
}));

vi.mock("../../services/question.js", () => ({
  createQuestionService: createQuestionServiceMock,
}));
vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-question-sheet";

function optionsRequest(id: string, overrides: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    id,
    sessionID: "ses_1",
    questions: [
      {
        question: "Which approach should I take for the refactor?",
        header: "Refactor approach",
        options: [
          { label: "Incremental", description: "Small steps, keep tests green" },
          { label: "Big bang", description: "Rewrite the module in one pass" },
        ],
      },
    ],
    ...overrides,
  };
}

function freeInputRequest(id: string): QuestionRequest {
  return {
    id,
    sessionID: "ses_1",
    questions: [
      {
        question: "Describe the feature you need.",
        header: "Feature details",
        options: [],
      },
    ],
  };
}

/** Installs a service mock with reply/reject resolving to true; returns them. */
function mockService() {
  const reply = vi.fn(async () => true);
  const reject = vi.fn(async () => true);
  createQuestionServiceMock.mockReturnValue({ list: vi.fn(), reply, reject });
  getApiClientMock.mockReturnValue({});
  return { reply, reject };
}

beforeEach(() => {
  resetQuestionStore(SERVER);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("QuestionSheet (overlay)", () => {
  it("renders the queue head with header chip and question text", () => {
    mockService();
    enqueue(SERVER, optionsRequest("que_1"));
    render(() => <QuestionSheet serverId={SERVER} variant="overlay" />);

    expect(screen.getByTestId("question-header").textContent).toBe("Refactor approach");
    expect(screen.getByTestId("question-text").textContent).toBe(
      "Which approach should I take for the refactor?",
    );
    // Single request: no position indicator.
    expect(screen.queryByTestId("question-queue-position")).toBeNull();
  });

  it("shows a 1-of-N indicator while multiple requests wait and advances the head", () => {
    mockService();
    enqueue(SERVER, optionsRequest("que_1"));
    enqueue(SERVER, freeInputRequest("que_2"));
    render(() => <QuestionSheet serverId={SERVER} variant="overlay" />);

    expect(screen.getByTestId("question-queue-position").textContent).toBe("1 of 2 waiting");
    expect(screen.getByTestId("question-text").textContent).toContain("refactor");

    // Store-level dequeue (the question.replied event path) advances to the
    // next request; the indicator hides with a single request left.
    dequeue(SERVER, "que_1");
    expect(screen.getByTestId("question-text").textContent).toBe("Describe the feature you need.");
    expect(screen.queryByTestId("question-queue-position")).toBeNull();
  });

  it("renders one option button per option and replies with the label", async () => {
    const { reply } = mockService();
    enqueue(SERVER, optionsRequest("que_1"));
    render(() => <QuestionSheet serverId={SERVER} variant="overlay" />);

    const options = screen.getAllByTestId("question-option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Incremental");
    expect(options[0].textContent).toContain("Small steps, keep tests green");

    fireEvent.click(options[0]);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("que_1", [["Incremental"]]));
    await vi.waitFor(() => expect(screen.queryByTestId("question-sheet")).toBeNull());
  });

  it("renders a free-input form without options and disables Send while empty", () => {
    mockService();
    enqueue(SERVER, freeInputRequest("que_1"));
    render(() => <QuestionSheet serverId={SERVER} variant="overlay" />);

    expect(screen.queryByTestId("question-options")).toBeNull();
    const send = screen.getByTestId("question-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect((screen.getByTestId("question-free-input") as HTMLTextAreaElement).value).toBe("");
  });

  it("sends the typed free-input text and drains the queue", async () => {
    const { reply } = mockService();
    enqueue(SERVER, freeInputRequest("que_1"));
    render(() => <QuestionSheet serverId={SERVER} variant="overlay" />);

    const input = screen.getByTestId("question-free-input");
    fireEvent.input(input, { target: { value: "Use the CLI instead" } });
    fireEvent.click(screen.getByTestId("question-send"));
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("que_1", [["Use the CLI instead"]]));
    await vi.waitFor(() => expect(screen.queryByTestId("question-sheet")).toBeNull());
  });

  it("Reject posts to the reject endpoint and drains the queue", async () => {
    const { reject } = mockService();
    enqueue(SERVER, optionsRequest("que_1"));
    render(() => <QuestionSheet serverId={SERVER} variant="overlay" />);

    fireEvent.click(screen.getByTestId("question-reject"));
    await vi.waitFor(() => expect(reject).toHaveBeenCalledWith("que_1"));
    await vi.waitFor(() => expect(screen.queryByTestId("question-sheet")).toBeNull());
  });

  it("locks the controls while a reply is in flight", async () => {
    let resolveReply!: (value: boolean) => void;
    const reply = vi.fn(() => new Promise<boolean>((resolve) => (resolveReply = resolve)));
    createQuestionServiceMock.mockReturnValue({
      list: vi.fn(),
      reply,
      reject: vi.fn(async () => true),
    });
    enqueue(SERVER, optionsRequest("que_1"));
    render(() => <QuestionSheet serverId={SERVER} variant="overlay" />);

    fireEvent.click(screen.getAllByTestId("question-option")[0]);
    expect(reply).toHaveBeenCalledWith("que_1", [["Incremental"]]);
    const buttons = screen.getAllByTestId("question-option");
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("question-reject") as HTMLButtonElement).disabled).toBe(true);

    resolveReply(true);
    await vi.waitFor(() => expect(screen.queryByTestId("question-sheet")).toBeNull());
  });

  it("keeps the request queued with an inline error when the reply fails", async () => {
    const reply = vi
      .fn<(id: string, answers: string[][]) => Promise<boolean>>()
      .mockRejectedValueOnce({ status: 404, code: "http", message: "not found", retriable: false })
      .mockResolvedValueOnce(true);
    const reject = vi.fn(async () => true);
    createQuestionServiceMock.mockReturnValue({ list: vi.fn(), reply, reject });
    enqueue(SERVER, optionsRequest("que_1"));
    render(() => <QuestionSheet serverId={SERVER} variant="overlay" />);

    fireEvent.click(screen.getAllByTestId("question-option")[0]);
    await vi.waitFor(() => expect(screen.getByTestId("question-error")).toBeTruthy());
    // Requeue: the card stays on the same request; a retry with another
    // action succeeds.
    expect(screen.getByTestId("question-text").textContent).toContain("refactor");
    fireEvent.click(screen.getByTestId("question-reject"));
    await vi.waitFor(() => expect(reject).toHaveBeenCalledWith("que_1"));
    await vi.waitFor(() => expect(screen.queryByTestId("question-sheet")).toBeNull());
  });

  it("keeps the draft on a failed free-input send and clears it on success", async () => {
    const reply = vi
      .fn<(id: string, answers: string[][]) => Promise<boolean>>()
      .mockRejectedValueOnce({ status: 500, code: "http", message: "boom", retriable: true })
      .mockResolvedValueOnce(true);
    createQuestionServiceMock.mockReturnValue({ list: vi.fn(), reply, reject: vi.fn() });
    enqueue(SERVER, freeInputRequest("que_1"));
    render(() => <QuestionSheet serverId={SERVER} variant="overlay" />);

    const input = screen.getByTestId("question-free-input") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "My answer" } });
    fireEvent.click(screen.getByTestId("question-send"));
    await vi.waitFor(() => expect(screen.getByTestId("question-error")).toBeTruthy());
    // The draft survives the failure so the user does not retype it.
    expect((screen.getByTestId("question-free-input") as HTMLTextAreaElement).value).toBe(
      "My answer",
    );

    fireEvent.click(screen.getByTestId("question-send"));
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.queryByTestId("question-sheet")).toBeNull());
  });

  it("renders a malformed request (no questions) defensively with Reject only", async () => {
    const { reject } = mockService();
    enqueue(SERVER, {
      id: "que_broken",
      sessionID: "ses_1",
      questions: [],
    });
    render(() => <QuestionSheet serverId={SERVER} variant="overlay" />);

    expect(screen.getByTestId("question-unavailable").textContent).toBe(
      "Question content unavailable.",
    );
    expect(screen.queryByTestId("question-text")).toBeNull();
    expect(screen.queryByTestId("question-options")).toBeNull();
    expect(screen.queryByTestId("question-send")).toBeNull();
    // The malformed request can still be settled.
    fireEvent.click(screen.getByTestId("question-reject"));
    await vi.waitFor(() => expect(reject).toHaveBeenCalledWith("que_broken"));
    await vi.waitFor(() => expect(screen.queryByTestId("question-sheet")).toBeNull());
  });

  it("cannot be dismissed with Escape", () => {
    mockService();
    enqueue(SERVER, optionsRequest("que_1"));
    render(() => <QuestionSheet serverId={SERVER} variant="overlay" />);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByTestId("question-text").textContent).toContain("refactor");
  });
});

describe("QuestionSheet (variant)", () => {
  it("renders nothing for the reserved mobile sheet variant", () => {
    mockService();
    enqueue(SERVER, optionsRequest("que_1"));
    render(() => <QuestionSheet serverId={SERVER} variant="sheet" />);
    expect(screen.queryByTestId("question-sheet")).toBeNull();
  });
});
