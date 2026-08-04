// L2 tests for the session list (TASK-M2-04/05): time-grouped rendering with
// headers and relative times, title fallback to slug, status badges per
// state (busy spinner / idle dot / error red dot, retry counts as busy),
// live badge updates through the store (SSE), case-insensitive local search
// with the no-match empty state, active-session highlight, row selection
// wiring, the no-sessions empty state and the TASK-M2-05 session actions:
// the per-row rename/delete menu, the rename dialog (prefilled, Enter
// submits, Esc cancels), the delete confirmation, optimistic rollback on
// service failure with inline errors, and the "+ New session" button
// (header + empty state) with its error banner.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import SessionList from "./SessionList";
import { ApiError } from "../../services/errors";
import type { Session } from "../../services/session";
import {
  applySessionList,
  getServerSessionState,
  resetServer,
  setActiveSession,
  setSessionStatus,
} from "../../stores/session";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-list";

// Wednesday Aug 5 2026 14:00 local (the Monday of that week is Aug 3).
const NOW = new Date(2026, 7, 5, 14, 0, 0, 0).getTime();
const TODAY = new Date(2026, 7, 5, 9, 0, 0).getTime(); // "5h ago"
const YESTERDAY = new Date(2026, 7, 4, 9, 0, 0).getTime();
const THIS_WEEK = new Date(2026, 7, 3, 9, 0, 0).getTime(); // Monday
const EARLIER = new Date(2026, 7, 2, 9, 0, 0).getTime(); // last Sunday

function session(id: string, updated: number, title = id): Session {
  return {
    id,
    slug: `slug-${id}`,
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title,
    version: "1.18.11",
    time: { created: updated, updated },
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

beforeEach(() => {
  resetServer(SERVER);
  getApiClientMock.mockReset();
  mockClient();
});
afterEach(() => resetServer(SERVER));

function renderList(onSelect: (id: string) => void = vi.fn()) {
  render(() => <SessionList serverId={SERVER} onSelect={onSelect} nowMs={NOW} />);
  return onSelect;
}

/** Opens the row's actions menu; the list must hold exactly one session. */
async function openActionsMenu(sessionId: string) {
  const menu = within(screen.getByTestId(`session-item-${sessionId}`)).getByTestId(
    "session-row-menu",
  );
  fireEvent.pointerDown(menu, { pointerType: "mouse" });
  await waitFor(() => expect(screen.getByTestId("session-menu-rename")).toBeInTheDocument());
  return menu;
}

async function pickMenuAction(testId: string) {
  fireEvent.pointerUp(screen.getByTestId(testId), { pointerType: "mouse" });
}

describe("SessionList", () => {
  it("renders time-grouped sessions with headers and relative times", () => {
    applySessionList(SERVER, [
      session("earlier", EARLIER),
      session("week", THIS_WEEK),
      session("yesterday", YESTERDAY),
      session("today", TODAY),
    ]);
    renderList();

    expect(
      screen.getAllByText(/^(Today|Yesterday|This Week|Earlier)$/).map((el) => el.textContent),
    ).toEqual(["Today", "Yesterday", "This Week", "Earlier"]);
    expect(screen.getByTestId("session-group-today")).toBeInTheDocument();
    expect(screen.getByTestId("session-group-yesterday")).toBeInTheDocument();
    expect(screen.getByTestId("session-group-thisWeek")).toBeInTheDocument();
    expect(screen.getByTestId("session-group-earlier")).toBeInTheDocument();
    for (const id of ["today", "yesterday", "week", "earlier"]) {
      expect(screen.getByTestId(`session-item-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByText("5h ago")).toBeInTheDocument();
  });

  it("falls back to the slug when the session has no title", () => {
    applySessionList(SERVER, [session("untitled", TODAY, "")]);
    renderList();

    const row = screen.getByTestId("session-item-untitled");
    expect(within(row).getByText("slug-untitled")).toBeInTheDocument();
  });

  it("shows a status badge per session state", () => {
    applySessionList(SERVER, [
      session("busy", TODAY),
      session("retry", YESTERDAY),
      session("idle", THIS_WEEK),
      session("error", EARLIER),
    ]);
    setSessionStatus(SERVER, "busy", { type: "busy" });
    setSessionStatus(SERVER, "retry", {
      type: "retry",
      attempt: 1,
      message: "backing off",
      next: 60_000,
    });
    setSessionStatus(SERVER, "idle", { type: "idle" });
    setSessionStatus(SERVER, "error", { type: "error", message: "provider 500" });
    renderList();

    const busyBadge = within(screen.getByTestId("session-item-busy")).getByTestId("session-status");
    expect(busyBadge).toHaveAttribute("data-status", "busy");
    expect(busyBadge).toHaveClass("animate-spin");

    const retryBadge = within(screen.getByTestId("session-item-retry")).getByTestId(
      "session-status",
    );
    expect(retryBadge).toHaveAttribute("data-status", "busy");
    expect(retryBadge).toHaveClass("animate-spin");

    const idleBadge = within(screen.getByTestId("session-item-idle")).getByTestId("session-status");
    expect(idleBadge).toHaveAttribute("data-status", "idle");
    expect(idleBadge).toHaveClass("bg-fg-faint");

    const errorBadge = within(screen.getByTestId("session-item-error")).getByTestId(
      "session-status",
    );
    expect(errorBadge).toHaveAttribute("data-status", "error");
    expect(errorBadge).toHaveClass("bg-danger");
  });

  it("updates badges live through the store", async () => {
    applySessionList(SERVER, [session("live", TODAY)]);
    setSessionStatus(SERVER, "live", { type: "idle" });
    renderList();

    const badge = within(screen.getByTestId("session-item-live")).getByTestId("session-status");
    expect(badge).toHaveAttribute("data-status", "idle");

    setSessionStatus(SERVER, "live", { type: "busy" });
    await waitFor(() => {
      const updated = within(screen.getByTestId("session-item-live")).getByTestId("session-status");
      expect(updated).toHaveAttribute("data-status", "busy");
      expect(updated).toHaveClass("animate-spin");
    });
  });

  it("filters sessions by title or slug, case-insensitively and trimmed", () => {
    applySessionList(SERVER, [
      session("alpha", TODAY, "Refactor auth flow"),
      session("beta", YESTERDAY, "Fix login bug"),
      session("gamma", THIS_WEEK, "Docs cleanup"),
    ]);
    renderList();
    const search = screen.getByTestId("session-search");

    fireEvent.input(search, { target: { value: "AUTH" } });
    expect(screen.getByTestId("session-item-alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("session-item-beta")).toBeNull();
    expect(screen.queryByTestId("session-item-gamma")).toBeNull();

    fireEvent.input(search, { target: { value: "slug-beta" } });
    expect(screen.getByTestId("session-item-beta")).toBeInTheDocument();
    expect(screen.queryByTestId("session-item-alpha")).toBeNull();

    fireEvent.input(search, { target: { value: "  docs  " } });
    expect(screen.getByTestId("session-item-gamma")).toBeInTheDocument();
    expect(screen.queryByTestId("session-item-alpha")).toBeNull();

    fireEvent.input(search, { target: { value: "" } });
    for (const id of ["alpha", "beta", "gamma"]) {
      expect(screen.getByTestId(`session-item-${id}`)).toBeInTheDocument();
    }
  });

  it("shows the no-match empty state when the filter matches nothing", () => {
    applySessionList(SERVER, [session("alpha", TODAY, "Refactor auth flow")]);
    renderList();

    fireEvent.input(screen.getByTestId("session-search"), { target: { value: "zzz" } });
    expect(screen.getByTestId("session-empty-filter")).toBeInTheDocument();
    expect(screen.getByText("No matching sessions")).toBeInTheDocument();
  });

  it("highlights the active session", () => {
    applySessionList(SERVER, [session("a", TODAY), session("b", YESTERDAY)]);
    setActiveSession(SERVER, "a");
    renderList();

    expect(screen.getByTestId("session-item-a")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("session-item-b")).toHaveAttribute("data-active", "false");
  });

  it("selecting a row calls onSelect and marks it active in the store", () => {
    applySessionList(SERVER, [session("a", TODAY), session("b", YESTERDAY)]);
    const onSelect = renderList();

    fireEvent.click(screen.getByTestId("session-item-b"));
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(getServerSessionState(SERVER).activeSessionId).toBe("b");
  });

  it("shows the no-sessions empty state", () => {
    renderList();

    expect(screen.getByTestId("session-empty")).toBeInTheDocument();
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
  });

  it("renders an enabled actions menu per row with rename/delete items", async () => {
    applySessionList(SERVER, [session("a", TODAY)]);
    renderList();

    const menu = within(screen.getByTestId("session-item-a")).getByTestId("session-row-menu");
    expect(menu).toBeEnabled();
    await openActionsMenu("a");
    expect(screen.getByTestId("session-menu-rename")).toHaveTextContent("Rename");
    expect(screen.getByTestId("session-menu-delete")).toHaveTextContent("Delete");
  });
});

describe("SessionList session actions (TASK-M2-05)", () => {
  it("renames a session via the dialog; Enter submits and closes it", async () => {
    applySessionList(SERVER, [session("a", TODAY, "Old title")]);
    const client = mockClient();
    renderList();

    await openActionsMenu("a");
    await pickMenuAction("session-menu-rename");

    const dialog = await screen.findByTestId("rename-session-dialog");
    const input = within(dialog).getByTestId("rename-session-input");
    expect(input).toHaveValue("Old title");

    fireEvent.input(input, { target: { value: "New title" } });
    fireEvent.submit(within(dialog).getByTestId("rename-session-form"));

    await waitFor(() =>
      expect(client.patch).toHaveBeenCalledWith("/session/a", { body: { title: "New title" } }),
    );
    expect(getServerSessionState(SERVER).sessions["a"]).toMatchObject({ title: "New title" });
    await waitFor(() => expect(screen.queryByTestId("rename-session-dialog")).toBeNull());
  });

  it("keeps the title prefilled and trimmed on submit", async () => {
    applySessionList(SERVER, [session("a", TODAY, "Old title")]);
    const client = mockClient();
    renderList();

    await openActionsMenu("a");
    await pickMenuAction("session-menu-rename");
    const dialog = await screen.findByTestId("rename-session-dialog");

    fireEvent.input(within(dialog).getByTestId("rename-session-input"), {
      target: { value: "  New title  " },
    });
    fireEvent.submit(within(dialog).getByTestId("rename-session-form"));

    await waitFor(() =>
      expect(client.patch).toHaveBeenCalledWith("/session/a", { body: { title: "New title" } }),
    );
  });

  it("cancels renaming with Esc without touching the service", async () => {
    applySessionList(SERVER, [session("a", TODAY, "Old title")]);
    const client = mockClient();
    renderList();

    await openActionsMenu("a");
    await pickMenuAction("session-menu-rename");
    await screen.findByTestId("rename-session-dialog");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("rename-session-dialog")).toBeNull());
    expect(client.patch).not.toHaveBeenCalled();
    expect(getServerSessionState(SERVER).sessions["a"]).toMatchObject({ title: "Old title" });
  });

  it("rolls the title back and shows an inline error when the rename fails", async () => {
    applySessionList(SERVER, [session("a", TODAY, "Old title")]);
    const client = mockClient();
    client.patch.mockRejectedValue(new ApiError(500, "http", "boom", true));
    renderList();

    await openActionsMenu("a");
    await pickMenuAction("session-menu-rename");
    const dialog = await screen.findByTestId("rename-session-dialog");

    fireEvent.input(within(dialog).getByTestId("rename-session-input"), {
      target: { value: "New title" },
    });
    fireEvent.submit(within(dialog).getByTestId("rename-session-form"));

    await waitFor(() =>
      expect(screen.getByTestId("rename-session-error")).toHaveTextContent("Server error"),
    );
    expect(screen.getByTestId("rename-session-dialog")).toBeInTheDocument();
    expect(getServerSessionState(SERVER).sessions["a"]).toMatchObject({ title: "Old title" });
  });

  it("deletes a session after the confirmation; cancel keeps it", async () => {
    applySessionList(SERVER, [session("a", TODAY, "Old title")]);
    const client = mockClient();
    renderList();

    await openActionsMenu("a");
    await pickMenuAction("session-menu-delete");

    const dialog = await screen.findByTestId("delete-session-dialog");
    expect(dialog).toHaveTextContent('Delete session "Old title"? This cannot be undone.');
    fireEvent.click(within(dialog).getByTestId("delete-session-cancel"));

    await waitFor(() => expect(screen.queryByTestId("delete-session-dialog")).toBeNull());
    expect(client.delete).not.toHaveBeenCalled();
    expect(getServerSessionState(SERVER).sessions["a"]).toBeDefined();
  });

  it("deletes a session after the confirmation; Enter-equivalent submit removes it", async () => {
    applySessionList(SERVER, [session("a", TODAY, "Old title")]);
    setActiveSession(SERVER, "a");
    const client = mockClient();
    renderList();

    await openActionsMenu("a");
    await pickMenuAction("session-menu-delete");

    const dialog = await screen.findByTestId("delete-session-dialog");
    fireEvent.click(within(dialog).getByTestId("delete-session-confirm"));

    await waitFor(() => expect(client.delete).toHaveBeenCalledWith("/session/a"));
    expect(getServerSessionState(SERVER).sessions["a"]).toBeUndefined();
    expect(getServerSessionState(SERVER).activeSessionId).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("delete-session-dialog")).toBeNull());
  });

  it("rolls the session back and shows an inline error when the delete fails", async () => {
    applySessionList(SERVER, [session("a", TODAY, "Old title")]);
    const client = mockClient();
    client.delete.mockRejectedValue(new ApiError(500, "http", "boom", true));
    renderList();

    await openActionsMenu("a");
    await pickMenuAction("session-menu-delete");
    const dialog = await screen.findByTestId("delete-session-dialog");

    fireEvent.click(within(dialog).getByTestId("delete-session-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-session-error")).toHaveTextContent("Server error"),
    );
    expect(screen.getByTestId("delete-session-dialog")).toBeInTheDocument();
    expect(getServerSessionState(SERVER).sessions["a"]).toMatchObject({ title: "Old title" });
  });

  it("creates a new session via the header button and opens it", async () => {
    const client = mockClient();
    const created = session("sess_new", TODAY, "");
    client.post.mockResolvedValue(created);
    renderList();

    fireEvent.click(screen.getByTestId("new-session-button"));

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", { body: { title: undefined } }),
    );
    const state = getServerSessionState(SERVER);
    expect(state.sessions["sess_new"]).toEqual(created);
    expect(state.activeSessionId).toBe("sess_new");
  });

  it("creates a new session from the empty state", async () => {
    const client = mockClient();
    const created = session("sess_new", TODAY, "");
    client.post.mockResolvedValue(created);
    renderList();

    expect(screen.getByTestId("session-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("new-session-empty-button"));

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", { body: { title: undefined } }),
    );
    expect(getServerSessionState(SERVER).activeSessionId).toBe("sess_new");
  });

  it("shows an error banner when creating fails", async () => {
    const client = mockClient();
    client.post.mockRejectedValue(new ApiError(500, "http", "boom", true));
    renderList();

    fireEvent.click(screen.getByTestId("new-session-button"));

    await waitFor(() =>
      expect(screen.getByTestId("error-banner")).toHaveTextContent("Server error"),
    );
    expect(getServerSessionState(SERVER).activeSessionId).toBeNull();

    fireEvent.click(screen.getByTestId("error-banner-dismiss"));
    expect(screen.queryByTestId("error-banner")).toBeNull();
  });
});
