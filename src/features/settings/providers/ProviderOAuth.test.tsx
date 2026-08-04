// L2 tests for the provider OAuth dialog (TASK-M5-07): opening it POSTs
// the authorize endpoint and opens the returned URL in the system browser
// (opener plugin); the auto flow polls the callback (mock `poll: true`
// extension) every 2s up to 60s and closes with a refresh on success,
// times out with an inline error, and stops polling on cancel/unmount;
// the code flow asks for the authorization code, submits it to the
// callback and closes on success while failures keep the dialog open with
// the draft retained; authorize/callback failures surface inline.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal, Show } from "solid-js";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import ProviderOAuth from "./ProviderOAuth";
import type { Provider } from "../../../services/provider";

const { getApiClientMock, openUrlMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  openUrlMock: vi.fn(),
}));

vi.mock("../../../services/client.js", () => ({ getApiClient: getApiClientMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

const AZURE: Provider = {
  id: "azure",
  name: "Azure OpenAI",
  source: "custom",
  env: [],
  options: {},
  models: {},
};
const GOOGLE: Provider = {
  id: "google",
  name: "Google",
  source: "env",
  env: [],
  options: {},
  models: {},
};

const AUTO_AUTH = {
  url: "https://auth.example/azure?state=oauth_state_1",
  method: "auto" as const,
  instructions: "Complete the authorization in the browser, then return here.",
};
const CODE_AUTH = {
  url: "https://auth.example/google?state=oauth_state_1",
  method: "code" as const,
  instructions: "Paste the code shown in the browser.",
};

function mockClient() {
  const client = {
    get: vi.fn(async () => undefined),
    post: vi.fn<(path: string, options?: { body?: unknown }) => Promise<unknown>>(
      async () => false,
    ),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

let client: ReturnType<typeof mockClient>;

beforeEach(() => {
  getApiClientMock.mockReset();
  openUrlMock.mockReset();
  openUrlMock.mockResolvedValue(undefined);
  client = mockClient();
});

afterEach(() => {
  vi.useRealTimers();
});

// Mirrors the ProviderKeys mount: the dialog unmounts (cleanup aborts any
// polling) when onClose fires.
function Harness(props: { provider: Provider; methodIndex?: number; onAuthorized?: () => void }) {
  const [open, setOpen] = createSignal(true);
  return (
    <Show when={open()}>
      <ProviderOAuth
        provider={props.provider}
        methodIndex={props.methodIndex ?? 0}
        onClose={() => setOpen(false)}
        onAuthorized={props.onAuthorized ?? (() => undefined)}
      />
    </Show>
  );
}

function renderDialog(provider: Provider, onAuthorized = vi.fn()) {
  const utils = render(() => <Harness provider={provider} onAuthorized={onAuthorized} />);
  return { onAuthorized, ...utils };
}

/** Flushes pending promise microtasks (no timers involved). */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ProviderOAuth", () => {
  it("auto flow: authorizes, opens the browser and polls to success", async () => {
    vi.useFakeTimers();
    client.post
      .mockResolvedValueOnce(AUTO_AUTH)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { onAuthorized } = renderDialog(AZURE);

    await vi.advanceTimersByTimeAsync(0);
    expect(client.post).toHaveBeenNthCalledWith(1, "/provider/azure/oauth/authorize", {
      body: { method: 0 },
    });
    expect(openUrlMock).toHaveBeenCalledWith("https://auth.example/azure?state=oauth_state_1");
    expect(screen.getByTestId("provider-oauth-waiting")).toBeInTheDocument();
    // Immediate first poll, then one poll after the 2s interval.
    expect(client.post).toHaveBeenNthCalledWith(2, "/provider/azure/oauth/callback", {
      body: { method: 0, poll: true },
    });

    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(client.post).toHaveBeenCalledTimes(3);
    expect(onAuthorized).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("provider-oauth-dialog")).not.toBeInTheDocument();
  });

  it("auto flow: times out with an inline error after the deadline", async () => {
    vi.useFakeTimers();
    client.post.mockResolvedValueOnce(AUTO_AUTH);
    // Every poll stays pending.
    client.post.mockResolvedValue(false);
    const { onAuthorized } = renderDialog(AZURE);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();

    expect(screen.getByTestId("provider-oauth-error")).toHaveTextContent(
      "Timed out waiting for the browser authorization to complete.",
    );
    expect(screen.getByTestId("provider-oauth-dialog")).toBeInTheDocument();
    expect(onAuthorized).not.toHaveBeenCalled();
    // No further polling after the deadline.
    const callsAtTimeout = client.post.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.post.mock.calls.length).toBe(callsAtTimeout);
  });

  it("auto flow: cancel stops polling and closes the dialog", async () => {
    vi.useFakeTimers();
    client.post.mockResolvedValueOnce(AUTO_AUTH);
    client.post.mockResolvedValue(false);
    const { onAuthorized } = renderDialog(AZURE);

    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeCancel = client.post.mock.calls.length;
    expect(callsBeforeCancel).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByTestId("provider-oauth-cancel"));
    await flush();
    expect(screen.queryByTestId("provider-oauth-dialog")).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.post.mock.calls.length).toBe(callsBeforeCancel);
    expect(onAuthorized).not.toHaveBeenCalled();
  });

  it("code flow: asks for the code, submits it and closes on success", async () => {
    client.post.mockResolvedValueOnce(CODE_AUTH);
    const { onAuthorized } = renderDialog(GOOGLE);
    await flush();

    expect(client.post).toHaveBeenCalledWith("/provider/google/oauth/authorize", {
      body: { method: 0 },
    });
    expect(openUrlMock).toHaveBeenCalledWith("https://auth.example/google?state=oauth_state_1");
    // The auto flow never starts — no callback polls.
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("provider-oauth-instructions")).toHaveTextContent(
      "Paste the code shown in the browser.",
    );

    client.post.mockResolvedValueOnce(true);
    fireEvent.input(screen.getByTestId("provider-oauth-code-input"), {
      target: { value: "mock-oauth-code" },
    });
    fireEvent.click(screen.getByTestId("provider-oauth-code-submit"));
    await waitFor(() => expect(onAuthorized).toHaveBeenCalledTimes(1));

    expect(client.post).toHaveBeenLastCalledWith("/provider/google/oauth/callback", {
      body: { method: 0, code: "mock-oauth-code" },
    });
    expect(screen.queryByTestId("provider-oauth-dialog")).not.toBeInTheDocument();
  });

  it("code flow: a rejected code shows the error and keeps the dialog open", async () => {
    client.post.mockResolvedValueOnce(CODE_AUTH);
    const { onAuthorized } = renderDialog(GOOGLE);
    await flush();

    client.post.mockResolvedValueOnce(false);
    fireEvent.input(screen.getByTestId("provider-oauth-code-input"), {
      target: { value: "wrong-code" },
    });
    fireEvent.click(screen.getByTestId("provider-oauth-code-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-oauth-error")).toHaveTextContent(
        "The authorization code was rejected.",
      ),
    );

    expect(screen.getByTestId("provider-oauth-dialog")).toBeInTheDocument();
    expect(onAuthorized).not.toHaveBeenCalled();
    expect((screen.getByTestId("provider-oauth-code-input") as HTMLInputElement).value).toBe(
      "wrong-code",
    );
  });

  it("code flow: a failing callback submit shows the error and stays open", async () => {
    client.post.mockResolvedValueOnce(CODE_AUTH);
    const { onAuthorized } = renderDialog(GOOGLE);
    await flush();

    client.post.mockRejectedValueOnce(new Error("boom"));
    fireEvent.input(screen.getByTestId("provider-oauth-code-input"), {
      target: { value: "mock-oauth-code" },
    });
    fireEvent.click(screen.getByTestId("provider-oauth-code-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-oauth-error")).toHaveTextContent(
        "Failed to submit the authorization code.",
      ),
    );

    expect(screen.getByTestId("provider-oauth-dialog")).toBeInTheDocument();
    expect(onAuthorized).not.toHaveBeenCalled();
  });

  it("code flow: submit is disabled while the draft is empty", async () => {
    client.post.mockResolvedValueOnce(CODE_AUTH);
    renderDialog(GOOGLE);
    await flush();

    const submit = screen.getByTestId("provider-oauth-code-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.input(screen.getByTestId("provider-oauth-code-input"), {
      target: { value: " " },
    });
    expect(submit.disabled).toBe(true);
    fireEvent.input(screen.getByTestId("provider-oauth-code-input"), {
      target: { value: "mock-oauth-code" },
    });
    expect(submit.disabled).toBe(false);
  });

  it("authorize failure surfaces an inline error", async () => {
    client.post.mockRejectedValueOnce(new Error("boom"));
    const { onAuthorized } = renderDialog(AZURE);
    await flush();

    expect(screen.getByTestId("provider-oauth-error")).toHaveTextContent(
      "Failed to start the OAuth authorization.",
    );
    expect(screen.getByTestId("provider-oauth-dialog")).toBeInTheDocument();
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(onAuthorized).not.toHaveBeenCalled();
  });
});
