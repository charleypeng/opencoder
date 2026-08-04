// L2 tests for the init dialog (TASK-M6-06): it requires the session to
// have a user message (the analysis request the AGENTS.md is generated
// from) — without one the confirm is disabled with a guidance note — and
// presets the most recent user message; Confirm POSTs /session/{id}/init
// with the provider/model pair plus the messageID, locks in flight,
// surfaces failures inline and toasts success on completion.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import InitDialog from "./InitDialog";
import type { Session } from "../../services/session";
import type { Model } from "../../services/provider";
import type { Message } from "../../stores/messages";
import { resetServer as resetModels, setProviders } from "../../stores/models";
import { applySessionList, resetServer as resetSessions } from "../../stores/session";
import { resetServer as resetMessages, upsertMessage } from "../../stores/messages";
import { clearToasts, toasts } from "../../stores/toasts";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-init";
const SESSION_ID = "sess_init_01";

function session(): Session {
  return {
    id: SESSION_ID,
    slug: "init-me",
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: "Init me",
    version: "1.18.11",
    time: { created: 1000, updated: 1000 },
  } as Session;
}

function userMessage(id: string, created: number): Message {
  return {
    id,
    sessionID: SESSION_ID,
    role: "user",
    time: { created },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5" },
  } as Message;
}

/** A fake ApiClient for the session service factory inside the component. */
function mockClient() {
  const client = {
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => undefined),
    post: vi.fn<(path: string, options?: { body?: unknown }) => Promise<unknown>>(
      async () => undefined,
    ),
    patch: vi.fn<(path: string, options?: { body?: unknown }) => Promise<unknown>>(
      async () => undefined,
    ),
    delete: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

beforeEach(() => {
  resetSessions(SERVER);
  resetModels(SERVER);
  resetMessages(SERVER);
  clearToasts();
  getApiClientMock.mockReset();
  mockClient();
  setProviders(SERVER, {
    all: [
      {
        id: "openai",
        name: "OpenAI",
        source: "env",
        env: [],
        options: {},
        models: {
          "gpt-5": { id: "gpt-5", providerID: "openai", name: "gpt-5" } as Model,
        },
      },
    ],
    default: { openai: "gpt-5" },
    connected: ["openai"],
  });
});

afterEach(() => {
  resetSessions(SERVER);
  resetModels(SERVER);
  resetMessages(SERVER);
  clearToasts();
});

function renderDialog(onClose = vi.fn()) {
  render(() => <InitDialog serverId={SERVER} session={session()} onClose={onClose} />);
  return onClose;
}

describe("InitDialog (TASK-M6-06)", () => {
  it("disables confirm with a guidance note when the session has no user message", () => {
    applySessionList(SERVER, [session()]);
    renderDialog();

    expect(screen.getByTestId("init-guidance")).toBeInTheDocument();
    expect(screen.getByTestId("init-message-preset")).toHaveTextContent(/no user message/i);
    expect(screen.getByTestId("init-confirm")).toBeDisabled();
  });

  it("presets the most recent user message", () => {
    applySessionList(SERVER, [session()]);
    upsertMessage(SERVER, SESSION_ID, userMessage("msg_old", 100));
    upsertMessage(SERVER, SESSION_ID, userMessage("msg_new", 200));
    upsertMessage(SERVER, SESSION_ID, {
      ...userMessage("msg_asst", 300),
      role: "assistant",
    } as Message);
    renderDialog();

    expect(screen.getByTestId("init-message-preset")).toHaveTextContent("msg_new");
    expect(screen.queryByTestId("init-guidance")).toBeNull();
    expect(screen.getByTestId("init-confirm")).toBeEnabled();
  });

  it("confirm POSTs init with the provider/model pair and the preset messageID", async () => {
    applySessionList(SERVER, [session()]);
    upsertMessage(SERVER, SESSION_ID, userMessage("msg_user", 100));
    const client = mockClient();
    client.post.mockResolvedValue(true);
    renderDialog();

    fireEvent.click(screen.getByTestId("init-confirm"));

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session/sess_init_01/init", {
        body: { providerID: "openai", modelID: "gpt-5", messageID: "msg_user" },
      }),
    );
    await waitFor(() =>
      expect(toasts.some((toast) => toast.message === "AGENTS.md generated")).toBe(true),
    );
  });

  it("disables confirm and shows a progress hint while generating", async () => {
    applySessionList(SERVER, [session()]);
    upsertMessage(SERVER, SESSION_ID, userMessage("msg_user", 100));
    const client = mockClient();
    let resolvePost: (value: unknown) => void = () => undefined;
    client.post.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );
    renderDialog();

    fireEvent.click(screen.getByTestId("init-confirm"));

    await waitFor(() => expect(screen.getByTestId("init-confirm")).toBeDisabled());
    expect(screen.getByTestId("init-confirm")).toHaveTextContent(/Generating/);
    resolvePost(true);
    await waitFor(() =>
      expect(toasts.some((toast) => toast.message === "AGENTS.md generated")).toBe(true),
    );
  });

  it("a failed init shows the inline error and keeps the dialog open", async () => {
    applySessionList(SERVER, [session()]);
    upsertMessage(SERVER, SESSION_ID, userMessage("msg_user", 100));
    const client = mockClient();
    client.post.mockRejectedValue({
      status: 400,
      code: "http",
      message: "unknown messageID",
      retriable: false,
    });
    renderDialog();

    fireEvent.click(screen.getByTestId("init-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("init-error")).toHaveTextContent(/unknown messageID/),
    );
    expect(screen.getByTestId("init-dialog")).toBeInTheDocument();
    expect(toasts.length).toBe(0);
  });

  it("Esc closes the dialog through onClose", () => {
    applySessionList(SERVER, [session()]);
    upsertMessage(SERVER, SESSION_ID, userMessage("msg_user", 100));
    const onClose = renderDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
