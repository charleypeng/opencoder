// ServerOAuthDialog tests (TASK-UI-01): the RFC 9728 consent dialog —
// authorize (builds the URL, opens the browser), paste code → exchange →
// onAuthorized, cancel, and the parseCallback URL/code parser.

import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServerOAuthDialog, { parseCallback } from "./ServerOAuthDialog";
import { authorizeOAuth, exchangeOAuth } from "../../services/servers";

vi.mock("../../services/servers", () => ({
  authorizeOAuth: vi.fn(),
  exchangeOAuth: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

const authorizeMock = vi.mocked(authorizeOAuth);
const exchangeMock = vi.mocked(exchangeOAuth);

function renderDialog(overrides: Partial<Parameters<typeof ServerOAuthDialog>[0]> = {}) {
  const props = {
    serverId: "srv_1",
    serverName: "Alpha",
    onClose: vi.fn(),
    onAuthorized: vi.fn(),
    ...overrides,
  };
  render(() => <ServerOAuthDialog {...props} />);
  return props;
}

describe("ServerOAuthDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeMock.mockResolvedValue({
      authorizationUrl: "https://app.example.com/oauth/authorize?code_challenge=abc&state=st_1",
      redirectUri: "http://127.0.0.1:44777/callback",
      clientId: "opencoder-client",
    });
    exchangeMock.mockResolvedValue(undefined);
  });

  it("starts the authorization and opens the browser on demand", async () => {
    const props = renderDialog();

    // The dialog opens idle with the "Open browser" action.
    expect(screen.getByTestId("server-oauth-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("server-oauth-open-browser"));

    await waitFor(() => expect(authorizeMock).toHaveBeenCalledWith("srv_1"));
    await waitFor(() => expect(screen.getByTestId("server-oauth-code-input")).toBeInTheDocument());
    // The code input appears after the browser opened.
    expect(screen.getByTestId("server-oauth-code-input")).toHaveAttribute(
      "placeholder",
      "Paste authorization code",
    );
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("exchanges the pasted code and reports success", async () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("server-oauth-open-browser"));
    await waitFor(() => screen.getByTestId("server-oauth-code-input"));

    fireEvent.input(screen.getByTestId("server-oauth-code-input"), {
      target: { value: "mock-server-oauth-code" },
    });
    fireEvent.click(screen.getByTestId("server-oauth-code-submit"));

    await waitFor(() =>
      expect(exchangeMock).toHaveBeenCalledWith("srv_1", "mock-server-oauth-code", ""),
    );
    await waitFor(() => expect(props.onAuthorized).toHaveBeenCalledTimes(1));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("accepts the full redirect URL and extracts code + state", async () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("server-oauth-open-browser"));
    await waitFor(() => screen.getByTestId("server-oauth-code-input"));

    fireEvent.input(screen.getByTestId("server-oauth-code-input"), {
      target: {
        value: "http://127.0.0.1:44777/callback?code=mock-server-oauth-code&state=st_1",
      },
    });
    fireEvent.click(screen.getByTestId("server-oauth-code-submit"));

    await waitFor(() =>
      expect(exchangeMock).toHaveBeenCalledWith("srv_1", "mock-server-oauth-code", "st_1"),
    );
    await waitFor(() => expect(props.onAuthorized).toHaveBeenCalledTimes(1));
  });

  it("shows an error when the exchange rejects and stays open", async () => {
    const props = renderDialog();
    exchangeMock.mockRejectedValueOnce(new Error("invalid_grant"));
    fireEvent.click(screen.getByTestId("server-oauth-open-browser"));
    await waitFor(() => screen.getByTestId("server-oauth-code-input"));

    fireEvent.input(screen.getByTestId("server-oauth-code-input"), {
      target: { value: "bad-code" },
    });
    fireEvent.click(screen.getByTestId("server-oauth-code-submit"));

    await waitFor(() => expect(screen.getByTestId("server-oauth-error")).toBeInTheDocument());
    expect(props.onAuthorized).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("cancel closes the dialog without authorizing", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("server-oauth-cancel"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onAuthorized).not.toHaveBeenCalled();
  });
});

describe("parseCallback", () => {
  it("passes a bare code through with an empty state", () => {
    expect(parseCallback("mock-code")).toEqual({ code: "mock-code", state: "" });
  });

  it("extracts code and state from a full redirect URL", () => {
    expect(parseCallback("http://127.0.0.1:44777/callback?code=abc&state=st_9")).toEqual({
      code: "abc",
      state: "st_9",
    });
  });

  it("falls back to the raw input when the URL has no code param", () => {
    expect(parseCallback("http://127.0.0.1:44777/callback?error=access_denied")).toEqual({
      code: "http://127.0.0.1:44777/callback?error=access_denied",
      state: "",
    });
  });
});
