// L2 tests for the mobile sessions page gestures (TASK-M7-06): rows swipe
// left to reveal Rename/Delete (commit threshold respected, one row open
// at a time, a tap on a revealed row closes it without navigating), the
// revealed buttons open the shared rename/delete dialogs, and pull-to-
// refresh re-fetches the session list + status map into the stores with
// the indicator holding while the round-trip is in flight. Gestures are
// driven with PointerEvents (swipe) and TouchEvents (pull; jsdom has no
// Touch constructor, so `touches` is injected).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { SessionsPage } from "./SessionsPage";
import { resetNav, topOf } from "./navigation";
import { applySessionList, resetServer as resetSessions } from "../../stores/session";
import type { Session } from "../../services/session";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const SERVER = "srv-swipe";

function session(id: string): Session {
  return {
    id,
    slug: id,
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: id,
    version: "1.18.11",
    time: { created: 1, updated: 1 },
  } as Session;
}

function httpResponse(body: unknown) {
  return { status: 200, headers: {}, body, bodyText: undefined };
}

function touchEvent(type: string, clientY: number): TouchEvent {
  const event = new TouchEvent(type, { cancelable: true });
  const touch = { clientY } as Touch;
  Object.defineProperty(event, "touches", { value: [touch], configurable: true });
  Object.defineProperty(event, "changedTouches", { value: [touch], configurable: true });
  return event;
}

/** Swipes the given row foreground left by `dx` px and releases. */
function swipeRowLeft(testId: string, dx = 150): void {
  const row = screen.getByTestId(testId);
  fireEvent.pointerDown(row, { clientX: 250, clientY: 40, button: 0 });
  fireEvent.pointerMove(window, { clientX: 250 - dx, clientY: 40 });
  fireEvent.pointerUp(window, { clientX: 250 - dx, clientY: 40 });
}

beforeEach(() => {
  resetNav();
  resetSessions(SERVER);
  invokeMock.mockClear();
  invokeMock.mockImplementation(async (_cmd: string, args: unknown) => {
    const req = (args as { request?: { method?: string; path?: string } }).request ?? {};
    if (req.method === "GET" && req.path === "/session") {
      return httpResponse([session("sess_1"), session("sess_2")]);
    }
    if (req.method === "GET" && req.path === "/session/status") {
      return httpResponse({});
    }
    if (req.method === "DELETE" && req.path?.startsWith("/session/")) {
      return httpResponse(true);
    }
    return httpResponse([]);
  });
});

afterEach(() => {
  resetNav();
  resetSessions(SERVER);
});

function renderPage() {
  return render(() => (
    <SessionsPage serverId={SERVER} onExit={vi.fn()} route={{ page: "sessions" }} />
  ));
}

describe("SessionsPage swipe actions", () => {
  it("swiping a row left reveals the rename/delete actions", () => {
    applySessionList(SERVER, [session("sess_1")]);
    renderPage();
    const row = screen.getByTestId("session-row-sess_1");

    // The foreground slides over the actions strip (128px wide).
    swipeRowLeft("session-row-sess_1");
    expect(row.parentElement!.style.transform).toBe("translateX(-128px)");
    expect(screen.getByTestId("session-swipe-rename-sess_1")).toBeInTheDocument();
    expect(screen.getByTestId("session-swipe-delete-sess_1")).toBeInTheDocument();
  });

  it("a small swipe is a mis-touch and snaps back", () => {
    applySessionList(SERVER, [session("sess_1")]);
    renderPage();
    const row = screen.getByTestId("session-row-sess_1");

    swipeRowLeft("session-row-sess_1", 20);
    expect(row.parentElement!.style.transform).toBe("translateX(0px)");
  });

  it("a vertical drag scrolls instead of revealing", () => {
    applySessionList(SERVER, [session("sess_1")]);
    renderPage();
    const row = screen.getByTestId("session-row-sess_1");

    fireEvent.pointerDown(row, { clientX: 250, clientY: 40, button: 0 });
    fireEvent.pointerMove(window, { clientX: 240, clientY: 120 });
    fireEvent.pointerUp(window, { clientX: 240, clientY: 120 });
    expect(row.parentElement!.style.transform).toBe("translateX(0px)");
  });

  it("revealing one row closes the others", async () => {
    applySessionList(SERVER, [session("sess_1"), session("sess_2")]);
    renderPage();

    swipeRowLeft("session-row-sess_1");
    expect(screen.getByTestId("session-row-sess_1").parentElement!.style.transform).toBe(
      "translateX(-128px)",
    );

    swipeRowLeft("session-row-sess_2");
    expect(screen.getByTestId("session-row-sess_2").parentElement!.style.transform).toBe(
      "translateX(-128px)",
    );
    await waitFor(() =>
      expect(screen.getByTestId("session-row-sess_1").parentElement!.style.transform).toBe(
        "translateX(0px)",
      ),
    );
  });

  it("a tap on a revealed row closes it without navigating", () => {
    applySessionList(SERVER, [session("sess_1")]);
    renderPage();
    const row = screen.getByTestId("session-row-sess_1");

    swipeRowLeft("session-row-sess_1");
    expect(row.parentElement!.style.transform).toBe("translateX(-128px)");

    // Tap (no movement): closes the reveal and swallows the click, so no
    // chat page is pushed.
    fireEvent.pointerDown(row, { clientX: 250, clientY: 40, button: 0 });
    fireEvent.pointerUp(window, { clientX: 250, clientY: 40 });
    fireEvent.click(row);
    expect(row.parentElement!.style.transform).toBe("translateX(0px)");
    expect(topOf().page).toBe("sessions");
  });

  it("a swipe that ends on the row does not navigate", () => {
    applySessionList(SERVER, [session("sess_1")]);
    renderPage();
    const row = screen.getByTestId("session-row-sess_1");

    swipeRowLeft("session-row-sess_1");
    fireEvent.click(row);
    expect(topOf().page).toBe("sessions");
  });

  it("the rename button opens the shared rename dialog and renames", async () => {
    applySessionList(SERVER, [session("sess_1")]);
    renderPage();
    swipeRowLeft("session-row-sess_1");

    fireEvent.click(screen.getByTestId("session-swipe-rename-sess_1"));
    await waitFor(() => expect(screen.getByTestId("rename-session-dialog")).toBeInTheDocument());

    fireEvent.input(screen.getByTestId("rename-session-input"), { target: { value: "New title" } });
    fireEvent.submit(screen.getByTestId("rename-session-form"));
    await waitFor(() => expect(screen.getByText("New title")).toBeInTheDocument());
  });

  it("the delete button opens the shared delete dialog and deletes", async () => {
    applySessionList(SERVER, [session("sess_1"), session("sess_2")]);
    renderPage();
    swipeRowLeft("session-row-sess_1");

    fireEvent.click(screen.getByTestId("session-swipe-delete-sess_1"));
    await waitFor(() => expect(screen.getByTestId("delete-session-dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("delete-session-confirm"));
    await waitFor(() => expect(screen.queryByTestId("session-row-sess_1")).not.toBeInTheDocument());
    expect(screen.getByTestId("session-row-sess_2")).toBeInTheDocument();
  });
});

describe("SessionsPage pull-to-refresh", () => {
  it("pulling past the threshold re-fetches the session list and statuses", async () => {
    applySessionList(SERVER, []);
    renderPage();
    const scroll = screen.getByTestId("mobile-sessions-scroll");

    fireEvent(scroll, touchEvent("touchstart", 0));
    fireEvent(scroll, touchEvent("touchmove", 80));
    fireEvent(scroll, touchEvent("touchend", 80));

    await waitFor(() => expect(screen.getByTestId("session-row-sess_1")).toBeInTheDocument());
    // Both refresh calls fired (list + status map).
    const calls = invokeMock.mock.calls.filter((call) => call[0] === "http_request");
    const paths = calls.map((call) => (call[1] as { request: { path: string } }).request.path);
    expect(paths).toContain("/session");
    expect(paths).toContain("/session/status");
    // The indicator released after the round-trip.
    await waitFor(() => expect(screen.getByTestId("pull-indicator").style.height).toBe("0px"));
  });

  it("a pull below the threshold does not refresh", async () => {
    applySessionList(SERVER, []);
    renderPage();
    const scroll = screen.getByTestId("mobile-sessions-scroll");

    fireEvent(scroll, touchEvent("touchstart", 0));
    fireEvent(scroll, touchEvent("touchmove", 40));
    fireEvent(scroll, touchEvent("touchend", 40));

    await waitFor(() => expect(screen.queryByTestId("session-row-sess_1")).not.toBeInTheDocument());
    const calls = invokeMock.mock.calls.filter((call) => call[0] === "http_request");
    expect(
      calls.filter(
        (call) => (call[1] as { request: { path: string } }).request.path === "/session",
      ),
    ).toHaveLength(0);
  });

  it("a failed refresh releases the indicator without an error", async () => {
    applySessionList(SERVER, [session("sess_1")]);
    invokeMock.mockImplementation(async () => {
      throw { status: 500, code: "http", message: "boom", retriable: true };
    });
    renderPage();
    const scroll = screen.getByTestId("mobile-sessions-scroll");

    fireEvent(scroll, touchEvent("touchstart", 0));
    fireEvent(scroll, touchEvent("touchmove", 80));
    fireEvent(scroll, touchEvent("touchend", 80));

    // The existing list stays, the indicator releases silently.
    await waitFor(() => expect(screen.getByTestId("pull-indicator").style.height).toBe("0px"));
    expect(screen.getByTestId("session-row-sess_1")).toBeInTheDocument();
  });
});
