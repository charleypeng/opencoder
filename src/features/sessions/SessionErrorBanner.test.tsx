// L2 tests for the session error banner (TASK-M2-10): a session.error status
// entry renders a dismissable banner with classified title and an
// expandable raw-detail section, dismiss reverts the status to idle (banner
// hides), any non-error status hides it, Retry re-sends the last prompt from
// the per-server history through the shared sendPrompt pipeline (a failed
// re-send re-arms the banner with the new message, a successful one
// dismisses), and rate-limit messages get the classified copy.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import SessionErrorBanner from "./SessionErrorBanner";
import { clearPrompts, pushPrompt } from "./promptHistory";
import type { Session } from "../../services/session";
import {
  applySessionList,
  getServerSessionState,
  resetServer as resetSessions,
  setSessionStatus,
} from "../../stores/session";
import { messages, resetServer as resetMessages } from "../../stores/messages";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-errbanner";
const SESSION = "ses_errbanner_01";

function sessionFixture(): Session {
  return {
    id: SESSION,
    slug: "errbanner-session",
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: "Error banner session",
    agent: "build",
    model: { id: "gpt-5", providerID: "openai" },
    version: "1.18.11",
    time: { created: 1, updated: 1 },
  } as Session;
}

function mockClient() {
  const client = {
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => []),
    post: vi.fn<(path: string, options?: { body?: unknown }) => Promise<unknown>>(
      async () => undefined,
    ),
    patch: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => undefined),
    delete: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

let client: ReturnType<typeof mockClient>;

beforeEach(() => {
  resetSessions(SERVER);
  resetMessages(SERVER);
  clearPrompts(SERVER);
  getApiClientMock.mockReset();
  client = mockClient();
  applySessionList(SERVER, [sessionFixture()]);
});
afterEach(() => {
  resetSessions(SERVER);
  resetMessages(SERVER);
  clearPrompts(SERVER);
});

function renderBanner() {
  render(() => <SessionErrorBanner serverId={SERVER} sessionId={SESSION} />);
}

describe("SessionErrorBanner", () => {
  it("renders nothing while the session is idle", () => {
    setSessionStatus(SERVER, SESSION, { type: "idle" });
    renderBanner();

    expect(screen.queryByTestId("session-error-banner")).not.toBeInTheDocument();
  });

  it("renders the classified title and an expandable raw detail for an error status", () => {
    setSessionStatus(SERVER, SESSION, { type: "error", message: "provider: boom" });
    renderBanner();

    expect(screen.getByTestId("session-error-title")).toHaveTextContent("Request failed");
    // The detail is behind the expander.
    expect(screen.queryByTestId("session-error-detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("session-error-expand"));
    expect(screen.getByTestId("session-error-detail")).toHaveTextContent("provider: boom");
    // Toggling collapses it again.
    fireEvent.click(screen.getByTestId("session-error-expand"));
    expect(screen.queryByTestId("session-error-detail")).not.toBeInTheDocument();
  });

  it("classifies rate-limit messages with dedicated copy", () => {
    setSessionStatus(SERVER, SESSION, {
      type: "error",
      message: "provider openai: rate limit exceeded",
    });
    renderBanner();

    expect(screen.getByTestId("session-error-title")).toHaveTextContent(
      "Rate limited — try again shortly",
    );
  });

  it("hides the expander when the error has no message", () => {
    setSessionStatus(SERVER, SESSION, { type: "error" });
    renderBanner();

    expect(screen.getByTestId("session-error-title")).toHaveTextContent("Request failed");
    expect(screen.queryByTestId("session-error-expand")).not.toBeInTheDocument();
  });

  it("dismisses via the close button (status reverts to idle)", () => {
    setSessionStatus(SERVER, SESSION, { type: "error", message: "boom" });
    renderBanner();
    fireEvent.click(screen.getByTestId("session-error-dismiss"));

    expect(screen.queryByTestId("session-error-banner")).not.toBeInTheDocument();
    expect(getServerSessionState(SERVER).statuses[SESSION]).toEqual({ type: "idle" });
  });

  it("auto-hides when a new status replaces the error", () => {
    setSessionStatus(SERVER, SESSION, { type: "error", message: "boom" });
    renderBanner();
    expect(screen.getByTestId("session-error-banner")).toBeInTheDocument();

    setSessionStatus(SERVER, SESSION, { type: "busy" });
    expect(screen.queryByTestId("session-error-banner")).not.toBeInTheDocument();
  });

  it("retry re-sends the last prompt and dismisses on success", async () => {
    pushPrompt(SERVER, "retry me");
    setSessionStatus(SERVER, SESSION, { type: "error", message: "boom" });
    renderBanner();

    fireEvent.click(screen.getByTestId("session-error-retry"));

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith(`/session/${SESSION}/prompt_async`, {
        body: { parts: [{ type: "text", text: "retry me" }] },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("session-error-banner")).not.toBeInTheDocument(),
    );
    // The optimistic message of the retried prompt is in the store.
    expect(Object.keys(messages[SERVER]?.[SESSION]?.infos ?? {})).toHaveLength(1);
  });

  it("re-arms the banner with the new message when the retry send fails", async () => {
    client.post.mockRejectedValueOnce({ code: "http", message: "second failure", status: 500 });
    pushPrompt(SERVER, "retry me");
    setSessionStatus(SERVER, SESSION, { type: "error", message: "first failure" });
    renderBanner();

    fireEvent.click(screen.getByTestId("session-error-retry"));

    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("session-error-title")).toHaveTextContent("Server error"),
    );
    fireEvent.click(screen.getByTestId("session-error-expand"));
    expect(screen.getByTestId("session-error-detail")).toHaveTextContent("second failure");
    // The failed retry rolled the optimistic message back.
    expect(Object.keys(messages[SERVER]?.[SESSION]?.infos ?? {})).toEqual([]);
  });

  it("hides the retry button when no prompt was ever sent", () => {
    setSessionStatus(SERVER, SESSION, { type: "error", message: "boom" });
    renderBanner();

    expect(screen.queryByTestId("session-error-retry")).not.toBeInTheDocument();
  });

  it("does not double-send on rapid retry clicks", async () => {
    client.post.mockImplementation(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    pushPrompt(SERVER, "retry me");
    setSessionStatus(SERVER, SESSION, { type: "error", message: "boom" });
    renderBanner();

    const retry = screen.getByTestId("session-error-retry") as HTMLButtonElement;
    fireEvent.click(retry);
    fireEvent.click(retry);

    await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
  });
});
