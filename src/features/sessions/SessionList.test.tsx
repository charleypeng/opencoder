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
import type { Model } from "../../services/provider";
import { resetServer as resetModels, setProviders } from "../../stores/models";
import {
  applySessionList,
  getServerSessionState,
  resetServer,
  setActiveSession,
  setSessionStatus,
} from "../../stores/session";

const { getApiClientMock, qrToDataURLMock, openUrlMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
  qrToDataURLMock: vi.fn(),
  openUrlMock: vi.fn(),
}));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));
vi.mock("qrcode", () => ({ default: { toDataURL: qrToDataURLMock } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

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
    // The directory listing (filepicker suggestions) defaults to empty;
    // tests that exercise the picker override it with FileNode fixtures.
    get: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(async () => []),
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
  resetModels(SERVER);
  getApiClientMock.mockReset();
  qrToDataURLMock.mockReset().mockResolvedValue("data:image/png;base64,QRDATA");
  openUrlMock.mockReset().mockResolvedValue(undefined);
  mockClient();
});
afterEach(() => resetServer(SERVER));

function renderList(onSelect: (id: string) => void = vi.fn()) {
  render(() => <SessionList serverId={SERVER} onSelect={onSelect} nowMs={NOW} />);
  return onSelect;
}

/** Opens the row's actions menu; the list must hold exactly one session.
 *  TASK-M8-03: the "⋯" trigger opens the shared ContextMenu. */
async function openActionsMenu(sessionId: string) {
  const menu = within(screen.getByTestId(`session-item-${sessionId}`)).getByTestId(
    "session-row-menu",
  );
  fireEvent.click(menu);
  await waitFor(() => expect(screen.getByTestId("session-menu-rename")).toBeInTheDocument());
  return menu;
}

async function pickMenuAction(testId: string) {
  fireEvent.click(screen.getByTestId(testId));
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
    expect(screen.getByTestId("session-menu-fork")).toHaveTextContent("Fork");
    expect(screen.getByTestId("session-menu-rename")).toHaveTextContent("Rename");
    expect(screen.getByTestId("session-menu-delete")).toHaveTextContent("Delete");
  });
});

describe("SessionList forks (TASK-M6-03)", () => {
  it("renders forked children indented below their parent with a fork badge", () => {
    const parent = session("parent", TODAY, "Parent session");
    const child = { ...session("child", TODAY + 1000, "Child session"), parentID: "parent" };
    applySessionList(SERVER, [parent, child]);
    renderList();

    // Sub-sessions are collapsed by default: the child is hidden until the
    // parent chevron expands the subtree.
    expect(screen.queryByTestId("session-item-child")).toBeNull();
    fireEvent.click(
      within(screen.getByTestId("session-item-parent")).getByTestId("session-tree-toggle"),
    );

    const rows = screen.getAllByTestId(/^session-item-/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "session-item-parent",
      "session-item-child",
    ]);
    const parentRow = screen.getByTestId("session-item-parent");
    const childRow = screen.getByTestId("session-item-child");
    expect(childRow).toHaveAttribute("data-forked", "true");
    expect(parentRow).toHaveAttribute("data-forked", "false");
    expect(within(childRow).getByTestId("session-fork-badge")).toHaveTextContent("fork");
    expect(within(childRow).getByTestId("session-fork-badge")).toHaveAttribute(
      "title",
      "Forked from Parent session",
    );
    expect(within(childRow).queryByText("Child session")).toBeInTheDocument();
    // The child is not a separate time-group row: only one group header.
    expect(screen.getAllByTestId(/^session-group-/)).toHaveLength(1);
  });

  it("keeps children with their parent when a search matches the parent", () => {
    const parent = session("parent", TODAY, "Alpha plan");
    const child = { ...session("child", TODAY + 1000, "Gamma work"), parentID: "parent" };
    applySessionList(SERVER, [parent, child]);
    renderList();

    fireEvent.click(
      within(screen.getByTestId("session-item-parent")).getByTestId("session-tree-toggle"),
    );
    fireEvent.input(screen.getByTestId("session-search"), { target: { value: "alpha" } });
    expect(screen.getByTestId("session-item-parent")).toBeInTheDocument();
    expect(screen.getByTestId("session-item-child")).toBeInTheDocument();
    expect(screen.getByTestId("session-item-child")).toHaveAttribute("data-forked", "true");
  });

  it("lets a child stand on its own when only it matches the search", () => {
    const parent = session("parent", TODAY, "Alpha plan");
    const child = { ...session("child", TODAY + 1000, "Gamma work"), parentID: "parent" };
    applySessionList(SERVER, [parent, child]);
    renderList();

    fireEvent.input(screen.getByTestId("session-search"), { target: { value: "gamma" } });
    expect(screen.queryByTestId("session-item-parent")).not.toBeInTheDocument();
    expect(screen.getByTestId("session-item-child")).toBeInTheDocument();
    expect(screen.getByTestId("session-item-child")).toHaveAttribute("data-forked", "true");
  });

  it("forks a session via the row menu and opens the child", async () => {
    const client = mockClient();
    const child = { ...session("sess_forked", TODAY + 2000, ""), parentID: "a" };
    client.post.mockResolvedValue(child);
    applySessionList(SERVER, [session("a", TODAY, "Parent session")]);
    renderList();

    await openActionsMenu("a");
    pickMenuAction("session-menu-fork");

    await waitFor(() => expect(client.post).toHaveBeenCalledWith("/session/a/fork", { body: {} }));
    const state = getServerSessionState(SERVER);
    expect(state.sessions["sess_forked"]).toEqual(child);
    expect(state.activeSessionId).toBe("sess_forked");
    // The forked child joins the tree under its parent; the parent starts
    // collapsed, so the fork's subtree is expanded manually to see it.
    fireEvent.click(
      within(screen.getByTestId("session-item-a")).getByTestId("session-tree-toggle"),
    );
    expect(
      within(screen.getByTestId("session-item-sess_forked")).getByTestId("session-fork-badge"),
    ).toBeInTheDocument();
  });

  it("shows an error banner when the fork fails", async () => {
    const client = mockClient();
    client.post.mockRejectedValue(new ApiError(500, "http", "boom", true));
    applySessionList(SERVER, [session("a", TODAY, "Parent session")]);
    renderList();

    await openActionsMenu("a");
    pickMenuAction("session-menu-fork");

    await waitFor(() =>
      expect(screen.getByTestId("error-banner")).toHaveTextContent("Server error"),
    );
    expect(getServerSessionState(SERVER).activeSessionId).toBeNull();
  });
});

describe("SessionList tree (TASK-M6-07)", () => {
  it("renders a multi-level tree with depth and connector marking", () => {
    const root = session("root", TODAY, "Root plan");
    const child = { ...session("child", TODAY + 1000, "Child work"), parentID: "root" };
    const grand = { ...session("grand", TODAY + 2000, "Grand detail"), parentID: "child" };
    applySessionList(SERVER, [root, child, grand]);
    renderList();

    // Sub-sessions are collapsed by default: expand both levels first.
    expect(screen.queryByTestId("session-item-child")).toBeNull();
    fireEvent.click(
      within(screen.getByTestId("session-item-root")).getByTestId("session-tree-toggle"),
    );
    fireEvent.click(
      within(screen.getByTestId("session-item-child")).getByTestId("session-tree-toggle"),
    );

    const rows = screen.getAllByTestId(/^session-item-/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "session-item-root",
      "session-item-child",
      "session-item-grand",
    ]);
    expect(screen.getByTestId("session-item-root")).toHaveAttribute("data-depth", "0");
    expect(screen.getByTestId("session-item-child")).toHaveAttribute("data-depth", "1");
    expect(screen.getByTestId("session-item-grand")).toHaveAttribute("data-depth", "2");
    // Nested rows carry the left connector border.
    expect(screen.getByTestId("session-item-child")).toHaveClass("border-l");
    expect(screen.getByTestId("session-item-grand")).toHaveClass("border-l");
    expect(screen.getByTestId("session-item-root")).not.toHaveClass("border-l");
    // Only the root is a group row; children hang directly under it.
    expect(screen.getAllByTestId(/^session-group-/)).toHaveLength(1);
  });

  it("collapses and re-expands a subtree via the parent chevron", () => {
    const root = session("root", TODAY, "Root plan");
    const child = { ...session("child", TODAY + 1000, "Child work"), parentID: "root" };
    const grand = { ...session("grand", TODAY + 2000, "Grand detail"), parentID: "child" };
    applySessionList(SERVER, [root, child, grand]);
    renderList();

    const rootToggle = () =>
      within(screen.getByTestId("session-item-root")).getByTestId("session-tree-toggle");
    // Sub-sessions are collapsed by default.
    expect(rootToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("session-item-child")).toBeNull();

    fireEvent.click(rootToggle());
    expect(rootToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("session-item-child")).toBeInTheDocument();
    // The child's own subtree is collapsed by default too; expand it.
    fireEvent.click(
      within(screen.getByTestId("session-item-child")).getByTestId("session-tree-toggle"),
    );
    expect(screen.getByTestId("session-item-grand")).toBeInTheDocument();

    fireEvent.click(rootToggle());
    expect(rootToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("session-item-child")).toBeNull();
    expect(screen.queryByTestId("session-item-grand")).toBeNull();
    expect(screen.getByTestId("session-item-root")).toBeInTheDocument();

    fireEvent.click(rootToggle());
    expect(rootToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("session-item-child")).toBeInTheDocument();
    // The child's subtree stayed expanded by the user's earlier toggle.
    expect(screen.getByTestId("session-item-grand")).toBeInTheDocument();
  });

  it("shows no chevron for leaf rows and keeps the fork badge on children", () => {
    const root = session("root", TODAY, "Root plan");
    const child = { ...session("child", TODAY + 1000, "Child work"), parentID: "root" };
    applySessionList(SERVER, [root, child]);
    renderList();

    const rootRow = screen.getByTestId("session-item-root");
    expect(within(rootRow).getByTestId("session-tree-toggle")).toBeInTheDocument();
    // Expand the collapsed subtree to reach the leaf row.
    fireEvent.click(within(rootRow).getByTestId("session-tree-toggle"));
    expect(
      within(screen.getByTestId("session-item-child")).queryByTestId("session-tree-toggle"),
    ).toBeNull();
    expect(
      within(screen.getByTestId("session-item-child")).getByTestId("session-fork-badge"),
    ).toHaveTextContent("fork");
  });

  it("selecting a parent via its row does not toggle the subtree", () => {
    const root = session("root", TODAY, "Root plan");
    const child = { ...session("child", TODAY + 1000, "Child work"), parentID: "root" };
    applySessionList(SERVER, [root, child]);
    const onSelect = renderList();

    // Expand first (the subtree is collapsed by default) so the child row
    // exists, then select the parent: selection must not toggle the tree.
    fireEvent.click(
      within(screen.getByTestId("session-item-root")).getByTestId("session-tree-toggle"),
    );
    fireEvent.click(screen.getByTestId("session-item-root"));
    expect(onSelect).toHaveBeenCalledWith("root");
    expect(getServerSessionState(SERVER).activeSessionId).toBe("root");
    expect(screen.getByTestId("session-item-child")).toBeInTheDocument();
  });

  it("does not duplicate a deep match under its matched ancestor (carry-over fix)", () => {
    const gp = session("gp", TODAY, "Alpha Gamma plan");
    const parent = { ...session("parent", TODAY + 1000, "Beta work"), parentID: "gp" };
    const grand = { ...session("grand", TODAY + 2000, "Gamma detail"), parentID: "parent" };
    applySessionList(SERVER, [gp, parent, grand]);
    renderList();

    // Expand both levels (sub-sessions start collapsed) so the deep match
    // can render inside the grandparent's subtree.
    fireEvent.click(
      within(screen.getByTestId("session-item-gp")).getByTestId("session-tree-toggle"),
    );
    fireEvent.click(
      within(screen.getByTestId("session-item-parent")).getByTestId("session-tree-toggle"),
    );
    fireEvent.input(screen.getByTestId("session-search"), { target: { value: "gamma" } });
    // gp AND grand match; the intermediate parent does not. The grandchild
    // must render ONCE, inside the grandparent's subtree, not also alone.
    expect(screen.getAllByTestId("session-item-grand")).toHaveLength(1);
    expect(screen.getByTestId("session-item-grand")).toHaveAttribute("data-depth", "2");
    expect(screen.getByTestId("session-item-gp")).toHaveAttribute("data-depth", "0");
    expect(screen.getByTestId("session-item-parent")).toHaveAttribute("data-depth", "1");
  });

  it("completes a parent's subtree from the server on re-expand", async () => {
    const client = mockClient();
    const known = { ...session("known", TODAY + 1000, "Known child"), parentID: "root" };
    const remote = { ...session("remote", TODAY + 3000, "Remote child"), parentID: "root" };
    // The server's authoritative list adds a child the store does not know.
    client.get.mockResolvedValue([known, remote]);
    applySessionList(SERVER, [session("root", TODAY, "Root plan"), known]);
    renderList();

    const toggle = () =>
      within(screen.getByTestId("session-item-root")).getByTestId("session-tree-toggle");
    // Sub-sessions are collapsed by default: the unknown child is hidden.
    expect(screen.queryByTestId("session-item-remote")).toBeNull();

    // Expand: the expand fires the one-shot /children fetch and the
    // unknown child joins the tree.
    fireEvent.click(toggle());

    await waitFor(() => expect(screen.getByTestId("session-item-remote")).toBeInTheDocument());
    expect(client.get).toHaveBeenCalledWith("/session/root/children", undefined);
    expect(screen.getByTestId("session-item-remote")).toHaveAttribute("data-depth", "1");
    expect(screen.getByTestId("session-item-remote")).toHaveAttribute("data-forked", "true");
  });

  it("keeps the tree intact when the children fetch fails", async () => {
    const client = mockClient();
    client.get.mockRejectedValue(new ApiError(500, "http", "boom", true));
    applySessionList(SERVER, [
      session("root", TODAY, "Root plan"),
      { ...session("child", TODAY + 1000, "Child work"), parentID: "root" },
    ]);
    renderList();

    const toggle = () =>
      within(screen.getByTestId("session-item-root")).getByTestId("session-tree-toggle");
    // Sub-sessions are collapsed by default: expand, then collapse, then
    // expand again — the second expand's children fetch fails.
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    // The failure is ignored (the store is the truth); the tree survives.
    expect(screen.getByTestId("session-item-root")).toBeInTheDocument();
    expect(screen.getByTestId("session-item-child")).toBeInTheDocument();
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

  it("opens the filepicker from the header button and creates a session in the browsed directory", async () => {
    const client = mockClient();
    const created = session("sess_new", TODAY, "");
    // The workspace root listing (GET /file?path=) feeds the suggestions.
    client.get.mockResolvedValue([
      {
        name: "src",
        path: "src/",
        absolute: "/mock/projects/opencode-demo/src",
        type: "directory",
        ignored: false,
      },
      {
        name: "README.md",
        path: "README.md",
        absolute: "/mock/projects/opencode-demo/README.md",
        type: "file",
        ignored: false,
      },
    ]);
    client.post.mockResolvedValue(created);
    renderList();

    fireEvent.click(screen.getByTestId("new-session-button"));
    const dialog = await waitFor(() => screen.getByTestId("filepicker-dialog"));
    expect(dialog).toBeInTheDocument();

    // The server directory listing appears as suggestions (folder first).
    await waitFor(() =>
      expect(screen.getByTestId("filepicker-suggestion-0")).toHaveTextContent("src"),
    );

    // Browsing into the folder fills the input with its absolute path;
    // Create posts with the directory query parameter.
    fireEvent.click(screen.getByTestId("filepicker-suggestion-0"));
    await waitFor(() =>
      expect(screen.getByTestId("filepicker-input")).toHaveValue(
        "/mock/projects/opencode-demo/src/",
      ),
    );
    fireEvent.click(screen.getByTestId("filepicker-create"));

    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", {
        body: { title: undefined },
        query: { directory: "/mock/projects/opencode-demo/src" },
      }),
    );
    const state = getServerSessionState(SERVER);
    expect(state.sessions["sess_new"]).toEqual(created);
    expect(state.activeSessionId).toBe("sess_new");
  });

  it("creates a session from the empty state through the filepicker with an empty input", async () => {
    const client = mockClient();
    const created = session("sess_new", TODAY, "");
    client.post.mockResolvedValue(created);
    renderList();

    expect(screen.getByTestId("session-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("new-session-empty-button"));
    await waitFor(() => expect(screen.getByTestId("filepicker-dialog")).toBeInTheDocument());

    // Empty input falls back to the plain new-session flow (no directory).
    fireEvent.click(screen.getByTestId("filepicker-create"));
    await waitFor(() =>
      expect(client.post).toHaveBeenCalledWith("/session", { body: { title: undefined } }),
    );
    expect(getServerSessionState(SERVER).activeSessionId).toBe("sess_new");
  });

  it("surfaces a create failure inside the filepicker", async () => {
    const client = mockClient();
    client.post.mockRejectedValue(new ApiError(500, "http", "boom", true));
    renderList();

    fireEvent.click(screen.getByTestId("new-session-button"));
    await waitFor(() => expect(screen.getByTestId("filepicker-dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("filepicker-create"));

    await waitFor(() =>
      expect(screen.getByTestId("filepicker-create-error")).toHaveTextContent("boom"),
    );
    expect(screen.getByTestId("filepicker-dialog")).toBeInTheDocument();
    expect(getServerSessionState(SERVER).activeSessionId).toBeNull();
  });
});

describe("SessionList share (TASK-M6-05)", () => {
  it("shows a shared badge on sessions carrying the share marker", () => {
    const shared = { ...session("a", TODAY, "Shared session"), share: { url: "https://share" } };
    applySessionList(SERVER, [shared, session("b", YESTERDAY, "Private session")]);
    renderList();

    expect(
      within(screen.getByTestId("session-item-a")).getByTestId("session-shared-badge"),
    ).toHaveTextContent("shared");
    expect(
      within(screen.getByTestId("session-item-b")).queryByTestId("session-shared-badge"),
    ).toBeNull();
  });

  it("opens the share dialog from the row menu", async () => {
    applySessionList(SERVER, [session("a", TODAY, "Session A")]);
    renderList();

    await openActionsMenu("a");
    await pickMenuAction("session-menu-share");

    const dialog = await screen.findByTestId("share-session-dialog");
    expect(dialog).toHaveTextContent("Session A");
  });

  it("shares a session from the row menu dialog; the row gains the badge", async () => {
    const client = mockClient();
    client.post.mockResolvedValue({
      ...session("a", TODAY, "Session A"),
      share: { url: "https://share.opencode.dev/s/a" },
    });
    applySessionList(SERVER, [session("a", TODAY, "Session A")]);
    renderList();

    await openActionsMenu("a");
    await pickMenuAction("session-menu-share");
    fireEvent.click(await screen.findByTestId("share-action"));

    await waitFor(() => expect(client.post).toHaveBeenCalledWith("/session/a/share", undefined));
    await waitFor(() =>
      expect(screen.getByTestId("share-url")).toHaveValue("https://share.opencode.dev/s/a"),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId("session-item-a")).getByTestId("session-shared-badge"),
      ).toBeInTheDocument(),
    );
  });
});

describe("SessionList summarize/init (TASK-M6-06)", () => {
  // Seed the models store so the dialogs' compact select finds connected
  // providers without a catalog fetch against the mock client.
  beforeEach(() => {
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

  it("opens the summarize dialog from the row menu", async () => {
    applySessionList(SERVER, [session("a", TODAY, "Session A")]);
    renderList();

    await openActionsMenu("a");
    await pickMenuAction("session-menu-summarize");

    const dialog = await screen.findByTestId("summarize-dialog");
    expect(dialog).toHaveTextContent("Session A");
    expect(dialog).toHaveTextContent("Compress context");
  });

  it("opens the init dialog from the row menu", async () => {
    applySessionList(SERVER, [session("a", TODAY, "Session A")]);
    renderList();

    await openActionsMenu("a");
    await pickMenuAction("session-menu-init");

    const dialog = await screen.findByTestId("init-dialog");
    expect(dialog).toHaveTextContent("Session A");
    expect(dialog).toHaveTextContent("Generate AGENTS.md");
  });
});

describe("SessionList row context menu (TASK-M8-03)", () => {
  it("opens the same menu on row right-click and runs the items", async () => {
    applySessionList(SERVER, [session("a", TODAY, "Session A")]);
    renderList();

    fireEvent.contextMenu(screen.getByTestId("session-item-a"), { clientX: 30, clientY: 40 });
    await waitFor(() => expect(screen.getByTestId("session-menu-rename")).toBeInTheDocument());
    expect(screen.getByTestId("session-menu-fork")).toHaveTextContent("Fork");
    expect(screen.getByTestId("session-menu-share")).toHaveTextContent("Share");
    expect(screen.getByTestId("session-menu-delete")).toHaveTextContent("Delete");
  });

  it("closes on the backdrop click and on Escape", async () => {
    applySessionList(SERVER, [session("a", TODAY)]);
    renderList();
    await openActionsMenu("a");

    fireEvent.click(screen.getByTestId("session-menu-backdrop"));
    await waitFor(() =>
      expect(screen.queryByTestId("session-menu-rename")).not.toBeInTheDocument(),
    );

    fireEvent.contextMenu(screen.getByTestId("session-item-a"), { clientX: 30, clientY: 40 });
    await waitFor(() => expect(screen.getByTestId("session-menu-rename")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("session-menu-rename")).not.toBeInTheDocument(),
    );
  });

  it("renders the Move to server placeholder submenu with its grayed item", async () => {
    applySessionList(SERVER, [session("a", TODAY)]);
    renderList();
    await openActionsMenu("a");

    fireEvent.mouseEnter(screen.getByTestId("session-menu-move-server"));
    expect(screen.getByTestId("session-menu-move-server-unavailable")).toBeDisabled();
    expect(screen.getByTestId("session-menu-move-server-unavailable")).toHaveTextContent(
      "Not available",
    );
  });

  it("the delete item is danger-styled", async () => {
    applySessionList(SERVER, [session("a", TODAY)]);
    renderList();
    await openActionsMenu("a");

    expect(screen.getByTestId("session-menu-delete").className).toContain("text-danger");
  });
});
