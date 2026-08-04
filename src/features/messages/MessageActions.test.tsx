// L2 tests for the message actions menu (TASK-M3-06): hover-triggered "⋯"
// menu and right-click context menu — copy text / copy code (mocked
// clipboard), the edit dialog (prefill, PATCH payload, resend through
// sendPrompt, cancel), the delete dialog (row stays mounted while the DELETE
// is in flight; inline error on failure), the view-diff placeholder and the
// assistant-message item gating.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { ApiClient, type Transport } from "../../services/client";
import type { Message, Part } from "../../stores/messages";
import { applyPartDelta, messages, resetServer, upsertMessage } from "../../stores/messages";
import MessageActions from "./MessageActions";

const { getApiClientMock, sendPromptMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  sendPromptMock: vi.fn(),
}));

vi.mock("../../services/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/client.js")>();
  return { ...actual, getApiClient: getApiClientMock };
});
vi.mock("../sessions/sendPrompt.js", () => ({ sendPrompt: sendPromptMock }));

const SERVER = "srv-actions-ui";
const SESSION = "ses_actions_ui_1";

let request: ReturnType<typeof vi.fn>;
let writeTextMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetServer(SERVER);
  getApiClientMock.mockReset();
  sendPromptMock.mockReset().mockResolvedValue(null);
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: writeTextMock },
  });
});

afterEach(() => {
  resetServer(SERVER);
  delete (navigator as { clipboard?: unknown }).clipboard;
});

/** Injects a client whose transport records every request; `result` is the
 *  resolved response body for the NEXT request. */
function mountWithClient(result: unknown = true): void {
  const transport: Transport = {
    request: vi.fn().mockResolvedValue({ status: 200, headers: {}, body: result }),
  };
  request = transport.request as ReturnType<typeof vi.fn>;
  getApiClientMock.mockReturnValue(new ApiClient(transport));
}

function userMessage(id: string): Message {
  return {
    id,
    sessionID: SESSION,
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5" },
  } as Message;
}

function textPart(id: string, messageID: string, text: string): Part {
  return { id, sessionID: SESSION, messageID, type: "text", text } as Part;
}

function seedUser(parts: Array<[string, string]>): void {
  upsertMessage(SERVER, SESSION, userMessage("msg_user"));
  for (const [id, text] of parts) {
    applyPartDelta(SERVER, SESSION, textPart(id, "msg_user", text));
  }
}

function seedAssistant(text: string): void {
  upsertMessage(SERVER, SESSION, {
    ...userMessage("msg_asst"),
    role: "assistant",
  } as Message);
  applyPartDelta(SERVER, SESSION, textPart("prt_asst", "msg_asst", text));
}

function mountActions(overrides: Partial<Parameters<typeof MessageActions>[0]> = {}) {
  return render(() => (
    <MessageActions
      serverId={SERVER}
      sessionId={SESSION}
      messageID="msg_user"
      partIds={["prt_1"]}
      {...overrides}
    />
  ));
}

/** Opens the "⋯" dropdown and waits for its items. */
async function openMenu() {
  fireEvent.pointerDown(screen.getByTestId("message-actions"), { pointerType: "mouse" });
  await waitFor(() => expect(screen.getByTestId("message-action-copy-text")).toBeInTheDocument());
}

/** Selects a dropdown item (Kobalte selects on pointerup). */
function pickMenuAction(testId: string) {
  fireEvent.pointerUp(screen.getByTestId(testId), { pointerType: "mouse" });
}

async function openContextMenu() {
  fireEvent.contextMenu(screen.getByTestId("message-msg_user"), { clientX: 30, clientY: 40 });
  await waitFor(() => expect(screen.getByTestId("message-context-menu")).toBeInTheDocument());
}

describe("MessageActions copy", () => {
  it("copy text writes the joined text parts to the clipboard", async () => {
    mountWithClient();
    seedUser([
      ["prt_1", "part one"],
      ["prt_2", "part two"],
    ]);
    mountActions({ partIds: ["prt_1", "prt_2"] });
    await openMenu();

    pickMenuAction("message-action-copy-text");
    expect(writeTextMock).toHaveBeenCalledWith("part one\npart two");
  });

  it("copy code extracts fenced blocks and joins them", async () => {
    mountWithClient();
    seedUser([["prt_1", "intro\n```ts\nconst a = 1;\n```\nmore\n```js\nconst b = 2;\n```\n"]]);
    mountActions();
    await openMenu();

    pickMenuAction("message-action-copy-code");
    expect(writeTextMock).toHaveBeenCalledWith("const a = 1;\n\nconst b = 2;");
  });

  it("copy code is disabled when the message has no fences", async () => {
    mountWithClient();
    seedUser([["prt_1", "no code here"]]);
    mountActions();
    await openMenu();

    expect(screen.getByTestId("message-action-copy-code")).toHaveAttribute("data-disabled");
  });
});

describe("MessageActions edit", () => {
  it("prefills the textarea, PATCHes the part and resends through sendPrompt", async () => {
    mountWithClient({
      id: "prt_1",
      sessionID: SESSION,
      messageID: "msg_user",
      type: "text",
      text: "edited text",
    });
    seedUser([["prt_1", "hello world"]]);
    mountActions();
    await openMenu();

    pickMenuAction("message-action-edit");
    await waitFor(() => expect(screen.getByTestId("edit-message-dialog")).toBeInTheDocument());
    const input = screen.getByTestId("edit-message-input") as HTMLTextAreaElement;
    expect(input.value).toBe("hello world");

    fireEvent.input(input, { target: { value: "edited text" } });
    fireEvent.click(screen.getByTestId("edit-message-send"));

    await waitFor(() =>
      expect(screen.queryByTestId("edit-message-dialog")).not.toBeInTheDocument(),
    );
    expect(request).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/session/ses_actions_ui_1/message/msg_user/part/prt_1",
      body: expect.objectContaining({ id: "prt_1", type: "text", text: "edited text" }),
    });
    expect(sendPromptMock).toHaveBeenCalledWith(SERVER, SESSION, "edited text");
    // The PATCH response replaced the part state in the store.
    expect(messages[SERVER][SESSION].parts["prt_1"]).toMatchObject({ text: "edited text" });
  });

  it("cancel closes the dialog without any request", async () => {
    mountWithClient();
    seedUser([["prt_1", "hello world"]]);
    mountActions();
    await openMenu();

    pickMenuAction("message-action-edit");
    await waitFor(() => expect(screen.getByTestId("edit-message-dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("edit-message-cancel"));

    await waitFor(() =>
      expect(screen.queryByTestId("edit-message-dialog")).not.toBeInTheDocument(),
    );
    expect(request).not.toHaveBeenCalled();
    expect(sendPromptMock).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the inline error when the PATCH fails", async () => {
    const transport: Transport = {
      request: vi
        .fn()
        .mockRejectedValue({ status: 404, code: "http", message: "missing", retriable: false }),
    };
    request = transport.request as ReturnType<typeof vi.fn>;
    getApiClientMock.mockReturnValue(new ApiClient(transport));
    seedUser([["prt_1", "hello world"]]);
    mountActions();
    await openMenu();

    pickMenuAction("message-action-edit");
    await waitFor(() => expect(screen.getByTestId("edit-message-dialog")).toBeInTheDocument());
    fireEvent.input(screen.getByTestId("edit-message-input") as HTMLTextAreaElement, {
      target: { value: "edited text" },
    });
    fireEvent.click(screen.getByTestId("edit-message-send"));

    await waitFor(() =>
      expect(screen.getByTestId("edit-message-error")).toHaveTextContent("missing"),
    );
    expect(screen.getByTestId("edit-message-dialog")).toBeInTheDocument();
    expect(sendPromptMock).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the error when the resend fails after the PATCH applied", async () => {
    mountWithClient({
      id: "prt_1",
      sessionID: SESSION,
      messageID: "msg_user",
      type: "text",
      text: "edited text",
    });
    sendPromptMock.mockResolvedValue({
      status: 429,
      code: "http",
      message: "rate limit",
      retriable: true,
    });
    seedUser([["prt_1", "hello world"]]);
    mountActions();
    await openMenu();

    pickMenuAction("message-action-edit");
    await waitFor(() => expect(screen.getByTestId("edit-message-dialog")).toBeInTheDocument());
    fireEvent.input(screen.getByTestId("edit-message-input") as HTMLTextAreaElement, {
      target: { value: "edited text" },
    });
    fireEvent.click(screen.getByTestId("edit-message-send"));

    await waitFor(() =>
      expect(screen.getByTestId("edit-message-error")).toHaveTextContent("rate limit"),
    );
    expect(screen.getByTestId("edit-message-dialog")).toBeInTheDocument();
    // The PATCH itself landed: the store shows the edited text.
    expect(messages[SERVER][SESSION].parts["prt_1"]).toMatchObject({ text: "edited text" });
  });

  it("edit is disabled for assistant messages", async () => {
    mountWithClient();
    seedAssistant("a reply");
    render(() => (
      <MessageActions
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_asst"
        partIds={["prt_asst"]}
      />
    ));
    await openMenu();

    expect(screen.getByTestId("message-action-edit")).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("message-action-delete")).toHaveAttribute("data-disabled");
  });
});

describe("MessageActions delete", () => {
  it("keeps the row and dialog mounted while the DELETE is in flight, then removes the message", async () => {
    let resolveDelete: (() => void) | undefined;
    const transport: Transport = {
      request: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDelete = () => resolve({ status: 200, headers: {}, body: true });
          }),
      ),
    };
    request = transport.request as ReturnType<typeof vi.fn>;
    getApiClientMock.mockReturnValue(new ApiClient(transport));
    seedUser([["prt_1", "hello world"]]);
    mountActions();
    await openMenu();

    pickMenuAction("message-action-delete");
    await waitFor(() => expect(screen.getByTestId("delete-message-dialog")).toBeInTheDocument());

    // In flight: no store removal yet, so the row (and the dialog that
    // lives in it) stays mounted and the button shows the pending state.
    fireEvent.click(screen.getByTestId("delete-message-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("delete-message-confirm")).toHaveTextContent("Deleting…"),
    );
    expect(messages[SERVER][SESSION].infos["msg_user"]).toBeDefined();
    expect(messages[SERVER][SESSION].order).toEqual(["prt_1"]);

    resolveDelete?.();
    await waitFor(() =>
      expect(screen.queryByTestId("delete-message-dialog")).not.toBeInTheDocument(),
    );
    expect(request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/session/ses_actions_ui_1/message/msg_user",
    });
    expect(messages[SERVER][SESSION].infos["msg_user"]).toBeUndefined();
    expect(messages[SERVER][SESSION].order).toEqual([]);
  });

  it("keeps the row and shows the inline error when the DELETE fails", async () => {
    const transport: Transport = {
      request: vi
        .fn()
        .mockRejectedValue({ status: 409, code: "http", message: "busy", retriable: false }),
    };
    request = transport.request as ReturnType<typeof vi.fn>;
    getApiClientMock.mockReturnValue(new ApiClient(transport));
    seedUser([["prt_1", "hello world"]]);
    mountActions();
    await openMenu();

    pickMenuAction("message-action-delete");
    await waitFor(() => expect(screen.getByTestId("delete-message-dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("delete-message-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-message-error")).toHaveTextContent("busy"),
    );
    // The row never left the store, so the dialog that reports the failure
    // is still mounted and the message is fully intact.
    expect(screen.getByTestId("delete-message-dialog")).toBeInTheDocument();
    const entry = messages[SERVER][SESSION];
    expect(entry.infos["msg_user"].id).toBe("msg_user");
    expect(entry.parts["prt_1"]).toMatchObject({ text: "hello world" });
    expect(entry.order).toEqual(["prt_1"]);
  });
});

describe("MessageActions view diff", () => {
  it("is a disabled placeholder without an onViewDiff callback", async () => {
    mountWithClient();
    seedUser([["prt_1", "hello world"]]);
    mountActions();
    await openMenu();

    expect(screen.getByTestId("message-action-view-diff")).toHaveAttribute("data-disabled");
  });

  it("calls onViewDiff with the message id when provided", async () => {
    mountWithClient();
    seedUser([["prt_1", "hello world"]]);
    let opened: string | undefined;
    mountActions({ onViewDiff: (id) => void (opened = id) });
    await openMenu();

    pickMenuAction("message-action-view-diff");
    expect(opened).toBe("msg_user");
  });
});

describe("MessageActions fork from here (TASK-M6-03)", () => {
  it("is a disabled placeholder without an onFork callback", async () => {
    mountWithClient();
    seedUser([["prt_1", "hello world"]]);
    mountActions();
    await openMenu();

    expect(screen.getByTestId("message-action-fork")).toHaveAttribute("data-disabled");
  });

  it("calls onFork with the message id when provided", async () => {
    mountWithClient();
    seedUser([["prt_1", "hello world"]]);
    let forked: string | undefined;
    mountActions({ onFork: (id) => void (forked = id) });
    await openMenu();

    pickMenuAction("message-action-fork");
    expect(forked).toBe("msg_user");
  });

  it("forks from an assistant message point too", async () => {
    mountWithClient();
    seedAssistant("a reply");
    let forked: string | undefined;
    render(() => (
      <MessageActions
        serverId={SERVER}
        sessionId={SESSION}
        messageID="msg_asst"
        partIds={["prt_asst"]}
        onFork={(id) => void (forked = id)}
      />
    ));
    await openMenu();

    pickMenuAction("message-action-fork");
    expect(forked).toBe("msg_asst");
  });

  it("runs from the right-click context menu as well", async () => {
    mountWithClient();
    seedUser([["prt_1", "hello world"]]);
    let forked: string | undefined;
    mountActions({ onFork: (id) => void (forked = id) });
    await openContextMenu();

    fireEvent.click(screen.getByTestId("message-context-fork"));
    expect(forked).toBe("msg_user");
  });
});

describe("MessageActions context menu", () => {
  it("opens at the cursor on right-click and runs the same actions", async () => {
    mountWithClient();
    seedUser([["prt_1", "```ts\nconst x = 1;\n```"]]);
    mountActions();
    await openContextMenu();

    fireEvent.click(screen.getByTestId("message-context-copy-code"));
    expect(writeTextMock).toHaveBeenCalledWith("const x = 1;");
    await waitFor(() =>
      expect(screen.queryByTestId("message-context-menu")).not.toBeInTheDocument(),
    );
  });

  it("closes on backdrop click and on Escape", async () => {
    mountWithClient();
    seedUser([["prt_1", "hello world"]]);
    mountActions();
    await openContextMenu();

    fireEvent.click(screen.getByTestId("message-context-backdrop"));
    await waitFor(() =>
      expect(screen.queryByTestId("message-context-menu")).not.toBeInTheDocument(),
    );

    await openContextMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("message-context-menu")).not.toBeInTheDocument(),
    );
  });

  it("opens the edit dialog from the context menu", async () => {
    mountWithClient();
    seedUser([["prt_1", "hello world"]]);
    mountActions();
    await openContextMenu();

    fireEvent.click(screen.getByTestId("message-context-edit"));
    await waitFor(() => expect(screen.getByTestId("edit-message-dialog")).toBeInTheDocument());
    expect((screen.getByTestId("edit-message-input") as HTMLTextAreaElement).value).toBe(
      "hello world",
    );
  });
});
