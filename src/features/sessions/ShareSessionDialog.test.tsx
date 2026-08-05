// L2 tests for the share session dialog (TASK-M6-05): a not-shared session
// offers the Share action (POST /session/{id}/share); once shared, the
// dialog shows the share URL with a copy button (clipboard + "Copied!"
// feedback), the QR code image (generated from the URL), an "Open in
// browser" button (opener plugin), the Unshare action (DELETE
// /session/{id}/share) and a note that the scanning device must reach the
// server. State flows through the sessions store, so share/unshare swap the
// view from the server's updated session; failures surface inline and keep
// the previous state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import ShareSessionDialog from "./ShareSessionDialog";
import { ApiError } from "../../services/errors";
import type { Session } from "../../services/session";
import { applySessionList, getServerSessionState, resetServer } from "../../stores/session";

const { getApiClientMock, qrToDataURLMock, openUrlMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  qrToDataURLMock: vi.fn(),
  openUrlMock: vi.fn(),
}));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));
vi.mock("qrcode", () => ({ default: { toDataURL: qrToDataURLMock } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

const SERVER = "srv-share-dialog";
const SHARE_URL = "https://share.opencode.dev/s/sess_share_01";
const QR_DATA_URL = "data:image/png;base64,QRDATA";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess_share_01",
    slug: "share-me",
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: "Share me",
    version: "1.18.11",
    time: { created: 1000, updated: 1000 },
    ...overrides,
  } as Session;
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

function renderDialog(overrides: Partial<Session> = {}, onClose = vi.fn()) {
  render(() => (
    <ShareSessionDialog serverId={SERVER} session={session(overrides)} onClose={onClose} />
  ));
  return onClose;
}

beforeEach(() => {
  resetServer(SERVER);
  getApiClientMock.mockReset();
  qrToDataURLMock.mockReset().mockResolvedValue(QR_DATA_URL);
  openUrlMock.mockReset().mockResolvedValue(undefined);
  mockClient();
});

afterEach(() => {
  resetServer(SERVER);
  vi.restoreAllMocks();
});

describe("ShareSessionDialog (TASK-M6-05)", () => {
  it("shares an unshared session and shows the URL, QR, copy and open actions", async () => {
    applySessionList(SERVER, [session()]);
    const client = mockClient();
    client.post.mockResolvedValue(session({ share: { url: SHARE_URL } }));
    renderDialog();

    expect(screen.getByTestId("share-session-dialog")).toHaveTextContent("Share me");
    fireEvent.click(screen.getByTestId("share-action"));

    await waitFor(() => expect(screen.getByTestId("share-url")).toHaveValue(SHARE_URL));
    expect(client.post).toHaveBeenCalledWith(
      "/session/sess_share_01/share",
      expect.not.objectContaining({ body: expect.anything() }),
    );
    // TASK-M9-08: `qrcode` is dynamically imported, so the generation call
    // lands a microtask after the URL renders.
    await waitFor(() => expect(qrToDataURLMock).toHaveBeenCalledWith(SHARE_URL, expect.anything()));
    await waitFor(() => expect(screen.getByTestId("share-qr")).toHaveAttribute("src", QR_DATA_URL));
    expect(screen.getByTestId("share-copy")).toBeInTheDocument();
    expect(screen.getByTestId("share-open")).toBeInTheDocument();
    expect(screen.getByTestId("share-unshare")).toBeInTheDocument();
    // The store now carries the share marker (the badge source of truth).
    expect(getServerSessionState(SERVER).sessions["sess_share_01"].share).toEqual({
      url: SHARE_URL,
    });
  });

  it("opens already-shared in the URL + QR view without a share call", async () => {
    applySessionList(SERVER, [session({ share: { url: SHARE_URL } })]);
    const client = mockClient();
    renderDialog();

    await waitFor(() => expect(screen.getByTestId("share-url")).toHaveValue(SHARE_URL));
    await waitFor(() => expect(screen.getByTestId("share-qr")).toHaveAttribute("src", QR_DATA_URL));
    expect(client.post).not.toHaveBeenCalled();
  });

  it("copy writes the URL to the clipboard with Copied feedback", async () => {
    applySessionList(SERVER, [session({ share: { url: SHARE_URL } })]);
    mockClient();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("share-url")).toHaveValue(SHARE_URL));

    fireEvent.click(screen.getByTestId("share-copy"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHARE_URL));
    await waitFor(() => expect(screen.getByTestId("share-copy")).toHaveTextContent("Copied"));
  });

  it("open in browser calls the opener plugin with the share URL", async () => {
    applySessionList(SERVER, [session({ share: { url: SHARE_URL } })]);
    mockClient();
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("share-url")).toHaveValue(SHARE_URL));

    fireEvent.click(screen.getByTestId("share-open"));

    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(SHARE_URL));
  });

  it("unshare clears the URL and QR and drops the share marker", async () => {
    applySessionList(SERVER, [session({ share: { url: SHARE_URL } })]);
    const client = mockClient();
    client.delete.mockResolvedValue(session());
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("share-url")).toHaveValue(SHARE_URL));

    fireEvent.click(screen.getByTestId("share-unshare"));

    await waitFor(() =>
      expect(client.delete).toHaveBeenCalledWith("/session/sess_share_01/share", undefined),
    );
    await waitFor(() => expect(screen.queryByTestId("share-url")).not.toBeInTheDocument());
    expect(getServerSessionState(SERVER).sessions["sess_share_01"].share).toBeUndefined();
    // The Share action is offered again.
    expect(screen.getByTestId("share-action")).toBeInTheDocument();
  });

  it("a failed share keeps the share button and shows the inline error", async () => {
    applySessionList(SERVER, [session()]);
    const client = mockClient();
    client.post.mockRejectedValue(new ApiError(500, "http", "boom", true));
    renderDialog();

    fireEvent.click(screen.getByTestId("share-action"));

    await waitFor(() => expect(screen.getByTestId("share-error")).toHaveTextContent(/boom/));
    expect(screen.getByTestId("share-action")).toBeInTheDocument();
    expect(screen.queryByTestId("share-url")).not.toBeInTheDocument();
    expect(qrToDataURLMock).not.toHaveBeenCalled();
  });

  it("a failed unshare keeps the URL and shows the inline error", async () => {
    applySessionList(SERVER, [session({ share: { url: SHARE_URL } })]);
    const client = mockClient();
    client.delete.mockRejectedValue(new ApiError(500, "http", "boom", true));
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("share-url")).toHaveValue(SHARE_URL));

    fireEvent.click(screen.getByTestId("share-unshare"));

    await waitFor(() => expect(screen.getByTestId("share-error")).toHaveTextContent(/boom/));
    expect(screen.getByTestId("share-url")).toHaveValue(SHARE_URL);
    expect(getServerSessionState(SERVER).sessions["sess_share_01"].share).toEqual({
      url: SHARE_URL,
    });
  });

  it("a failed open in browser shows the inline error and keeps the URL", async () => {
    applySessionList(SERVER, [session({ share: { url: SHARE_URL } })]);
    mockClient();
    openUrlMock.mockRejectedValue(new Error("no browser"));
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("share-url")).toHaveValue(SHARE_URL));

    fireEvent.click(screen.getByTestId("share-open"));

    await waitFor(() => expect(screen.getByTestId("share-error")).toHaveTextContent(/no browser/));
    expect(screen.getByTestId("share-url")).toHaveValue(SHARE_URL);
  });

  it("shows the reachability note for the scanning device", async () => {
    applySessionList(SERVER, [session({ share: { url: SHARE_URL } })]);
    mockClient();
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("share-url")).toHaveValue(SHARE_URL));

    const dialog = screen.getByTestId("share-session-dialog");
    expect(within(dialog).getByText(/reach the server/i)).toBeInTheDocument();
  });

  it("Esc closes the dialog through onClose", async () => {
    applySessionList(SERVER, [session()]);
    mockClient();
    const onClose = renderDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
