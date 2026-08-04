// L2 tests for the message history list (TASK-M2-06): history fetch on
// mount merged into the messages store, user/assistant bubble distinction
// with timestamps, the reasoning fold (collapsed by default, expand on
// click), tool cards in their v1 states, graceful skipping of unsupported
// part types, loading / empty / error + retry states, the streaming
// fallback for parts without message info, auto-scroll pause with the
// "New messages" jump button, and a fixture snapshot.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import MessageList from "./MessageList";
import type { SessionMessage } from "../../services/message";
import { ApiError } from "../../services/errors";
import { applyPartDelta, applyTextDelta, resetServer } from "../../stores/messages";

import historyFixtureJson from "../../../tests/fixtures/session.messages.json";
import allPartsFixtureJson from "../../../tests/fixtures/message.stream.all-parts.json";

const historyFixture = historyFixtureJson as unknown as SessionMessage[];
const allPartsFixture = allPartsFixtureJson as unknown as SessionMessage;

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-msg";
const SESSION = "ses_1";

function mockClient(history: SessionMessage[]) {
  const client = {
    get: vi.fn(async () => history),
    post: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

beforeEach(() => {
  getApiClientMock.mockReset();
  mockClient([]);
});

afterEach(() => {
  resetServer(SERVER);
});

function renderList(serverId = SERVER, sessionId = SESSION) {
  return render(() => <MessageList serverId={serverId} sessionId={sessionId} />);
}

/** Renders the list with the fixture history and waits for the bubbles. */
async function renderHistory() {
  mockClient(historyFixture);
  renderList();
  await waitFor(() => expect(screen.getByTestId("message-msg_m4")).toBeInTheDocument());
}

describe("MessageList", () => {
  it("renders user and assistant bubbles with timestamps", async () => {
    await renderHistory();

    const user = screen.getByTestId("message-msg_m1");
    const assistant = screen.getByTestId("message-msg_m2");
    expect(user).toHaveAttribute("data-role", "user");
    expect(assistant).toHaveAttribute("data-role", "assistant");
    expect(user).toHaveTextContent("Add a login flow with password-based auth.");
    expect(assistant).toHaveTextContent("Let me check the existing project structure first.");
    expect(screen.getAllByTestId("message-time")).toHaveLength(4);
  });

  it("keeps the reasoning fold collapsed and expands it on click", async () => {
    await renderHistory();

    const assistant = screen.getByTestId("message-msg_m2");
    const toggle = within(assistant).getByTestId("reasoning-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(assistant).queryByTestId("reasoning-body")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(assistant).getByTestId("reasoning-body")).toHaveTextContent(
      "The client needs a login form",
    );
  });

  it("renders tool cards with running and completed states and expandable payloads", async () => {
    await renderHistory();

    const assistant = screen.getByTestId("message-msg_m2");
    const running = within(assistant).getAllByTestId("tool-part")[0];
    const completed = within(assistant).getAllByTestId("tool-part")[1];
    expect(running).toHaveAttribute("data-status", "running");
    expect(completed).toHaveAttribute("data-status", "completed");
    expect(within(running).getByTestId("tool-status-label")).toHaveTextContent("Running…");
    expect(within(completed).getByTestId("tool-status-label")).toHaveTextContent("Completed");

    fireEvent.click(within(completed).getByTestId("tool-toggle"));
    expect(within(completed).getByText(/ls src/)).toBeInTheDocument();
    expect(within(completed).getByText(/auth/)).toBeInTheDocument();
    expect(within(completed).getByText("Output")).toBeInTheDocument();
  });

  it("renders every supported part from the all-parts fixture and skips the rest", async () => {
    mockClient([allPartsFixture]);
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-msg_m2")).toBeInTheDocument());

    // text / reasoning / tool render; unsupported types (step-start, file,
    // subtask, retry, compaction, patch, snapshot, step-finish) are skipped.
    expect(
      screen.getByText("Let me check the existing project structure first."),
    ).toBeInTheDocument();
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getAllByTestId("tool-part")).toHaveLength(2);
    expect(screen.queryByText(/Implement the auth API client/)).not.toBeInTheDocument();
  });

  it("shows the empty state when the session has no messages", async () => {
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-empty")).toBeInTheDocument());
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
  });

  it("shows an error banner with retry that recovers the history", async () => {
    const client = mockClient(historyFixture);
    client.get.mockRejectedValueOnce(new ApiError(500, "http", "boom", true));
    renderList();

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    expect(screen.queryByTestId("message-empty")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("message-retry"));
    await waitFor(() => expect(screen.getByTestId("message-msg_m1")).toBeInTheDocument());
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });

  it("renders streamed parts without message info as an assistant fallback", async () => {
    renderList();
    await waitFor(() => expect(screen.getByTestId("message-empty")).toBeInTheDocument());

    applyTextDelta(SERVER, SESSION, {
      messageID: "msg_stream",
      partID: "prt_stream",
      field: "text",
      delta: "Hello stream",
    });
    const bubble = await waitFor(() => screen.getByTestId("message-msg_stream"));
    expect(bubble).toHaveAttribute("data-role", "assistant");
    expect(within(bubble).getByText("Hello stream")).toBeInTheDocument();
    expect(within(bubble).queryByTestId("message-time")).not.toBeInTheDocument();
  });

  it("pauses auto-scroll on scroll-up and offers a New messages jump button", async () => {
    await renderHistory();
    const scroll = screen.getByTestId("message-list-scroll");
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scroll, "scrollTop", { configurable: true, value: 100, writable: true });

    fireEvent.scroll(scroll);
    expect(screen.queryByTestId("message-jump")).not.toBeInTheDocument();

    // Content arriving while paused flags the jump button.
    applyPartDelta(SERVER, SESSION, {
      id: "prt_new",
      sessionID: SESSION,
      messageID: "msg_m4",
      type: "text",
      text: "extra reply",
    });
    await waitFor(() => expect(screen.getByTestId("message-jump")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("message-jump"));
    await waitFor(() => expect(screen.queryByTestId("message-jump")).not.toBeInTheDocument());
  });

  it("matches the fixture history snapshot", async () => {
    const timeSpy = vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("10:26");
    mockClient(historyFixture);
    const { container } = renderList();
    await waitFor(() => expect(screen.getByTestId("message-msg_m4")).toBeInTheDocument());
    expect(container).toMatchSnapshot();
    timeSpy.mockRestore();
  });
});
