// L2 tests for the credential re-entry dialog (TASK-M1-09): rendering with
// the username prefilled and a blank password, the empty-password guard, the
// Save & Retry submit (success passes the credentials upward, failure shows
// the classified error and keeps the dialog open) and Cancel.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import ReauthDialog from "./ReauthDialog";
import { ApiError } from "../../services/errors";
import type { AuthCredentials, ServerEntry } from "../../services/servers";

function server(overrides: Partial<ServerEntry> = {}): ServerEntry {
  return {
    id: "srv-1",
    name: "Alpha",
    url: "http://localhost:14096",
    username: "admin",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

const reason401 = new ApiError(401, "http", '{"error":"unauthorized"}', false);

describe("ReauthDialog", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders with the stored username prefilled and a blank password", () => {
    render(() => (
      <ReauthDialog server={server()} reason={reason401} onSubmit={vi.fn()} onCancel={vi.fn()} />
    ));
    expect(screen.getByTestId("reauth-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("reauth-username")).toHaveValue("admin");
    expect(screen.getByTestId("reauth-password")).toHaveValue("");
    expect(screen.getByTestId("reauth-save")).toHaveTextContent("Save & Retry");
  });

  it("shows the triggering 401 as context", () => {
    render(() => (
      <ReauthDialog server={server()} reason={reason401} onSubmit={vi.fn()} onCancel={vi.fn()} />
    ));
    expect(screen.getByTestId("reauth-reason")).toHaveTextContent("Alpha");
    expect(screen.getByTestId("reauth-reason")).toHaveTextContent("Authentication required");
  });

  it("keeps Save & Retry disabled until a password is typed", () => {
    render(() => (
      <ReauthDialog server={server()} reason={reason401} onSubmit={vi.fn()} onCancel={vi.fn()} />
    ));
    expect(screen.getByTestId("reauth-save")).toBeDisabled();
    fireEvent.input(screen.getByTestId("reauth-password"), { target: { value: "newpw" } });
    expect(screen.getByTestId("reauth-save")).toBeEnabled();
  });

  it("submits the entered credentials on Save & Retry", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <ReauthDialog server={server()} reason={reason401} onSubmit={onSubmit} onCancel={vi.fn()} />
    ));
    fireEvent.input(screen.getByTestId("reauth-password"), { target: { value: "newpw" } });
    fireEvent.click(screen.getByTestId("reauth-save"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const credentials = onSubmit.mock.calls[0][0] as AuthCredentials;
    expect(credentials).toEqual({ username: "admin", password: "newpw" });
    expect(screen.queryByTestId("reauth-error")).toBeNull();
  });

  it("shows the classified error and stays open when verification fails", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new ApiError(401, "http", '{"error":"unauthorized"}', false));
    render(() => (
      <ReauthDialog server={server()} reason={reason401} onSubmit={onSubmit} onCancel={vi.fn()} />
    ));
    fireEvent.input(screen.getByTestId("reauth-password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByTestId("reauth-save"));

    await waitFor(() =>
      expect(screen.getByTestId("reauth-error")).toHaveTextContent("Authentication required"),
    );
    expect(screen.getByTestId("reauth-error")).toHaveTextContent("unauthorized");
    expect(screen.getByTestId("reauth-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("reauth-save")).toBeEnabled();
  });

  it("closes via Cancel without submitting", () => {
    const onCancel = vi.fn();
    render(() => (
      <ReauthDialog server={server()} reason={reason401} onSubmit={vi.fn()} onCancel={onCancel} />
    ));
    fireEvent.click(screen.getByTestId("reauth-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
