// L2 tests for the subtask panel (sidebar nav redesign): the drawer beside
// the chat shows the session's Todo list (via TodoPanel) plus its sub-agent
// child sessions from GET /session/{id}/children, merged into the session
// store so SSE session.updated keeps them fresh. Child rows carry a status
// dot + title + relative time; clicking one reports the session id. The
// empty state renders when a session has no children.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import SubtaskPanel from "./SubtaskPanel";
import type { Session } from "../../services/session";
import type { Todo } from "../../services/todo";
import { resetServer as resetModels } from "../../stores/models";
import { resetServer as resetProjects } from "../../stores/project";
import {
  applySessionList,
  getServerSessionState,
  resetServer as resetSessions,
  setSessionStatus,
} from "../../stores/session";
import { applyTodos, resetServer as resetTodos } from "../../stores/todos";

const { getApiClientMock } = vi.hoisted(() => ({ getApiClientMock: vi.fn() }));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-subtasks";
const PARENT = "sess_parent";
const CHILD_A = "sess_child_a";

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    slug: `slug-${id}`,
    projectID: "prj",
    directory: "/dev/opencoder",
    title: `Title ${id}`,
    version: "1.18.11",
    time: { created: 100, updated: 100 },
    ...overrides,
  } as Session;
}

function todo(id: string, content: string, status: Todo["status"] = "pending"): Todo {
  return { id, content, status, createdAt: 1, updatedAt: 1 } as unknown as Todo;
}

function mockClient(children: Session[]) {
  const client = {
    get: vi.fn(async (path: string) => {
      if (path === `/session/${PARENT}/children`) return children;
      if (path === `/session/${PARENT}/todo`) return [todo("t1", "Explore the repo.")];
      return [];
    }),
    post: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  getApiClientMock.mockReturnValue(client);
  return client;
}

beforeEach(() => {
  resetSessions(SERVER);
  resetTodos(SERVER);
  resetProjects(SERVER);
  resetModels(SERVER);
  localStorage.clear();
  getApiClientMock.mockReset();
  mockClient([]);
});

afterEach(() => {
  resetSessions(SERVER);
  resetTodos(SERVER);
});

function renderPanel(onSelect: (id: string) => void = vi.fn()) {
  render(() => <SubtaskPanel serverId={SERVER} sessionId={PARENT} onSelectSession={onSelect} />);
  return onSelect;
}

describe("SubtaskPanel", () => {
  it("renders the todo list from the todo store", async () => {
    applyTodos(SERVER, PARENT, [todo("t1", "Explore the repo.")]);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("todo-panel")).toBeInTheDocument());
    expect(screen.getByText("Explore the repo.")).toBeInTheDocument();
  });

  it("fetches and renders child sessions with status dots", async () => {
    mockClient([session(CHILD_A, { parentID: PARENT, time: { created: 1, updated: 200 } })]);
    applySessionList(SERVER, [session(PARENT)]);
    setSessionStatus(SERVER, CHILD_A, { type: "busy" });
    renderPanel();

    await waitFor(() => expect(screen.getByTestId(`subtask-child-${CHILD_A}`)).toBeInTheDocument());
    expect(screen.getByTestId("subtask-count")).toHaveTextContent("1");
    expect(screen.getByTestId("subtask-child-status")).toHaveAttribute(
      "data-testid",
      "subtask-child-status",
    );
    expect(screen.getByText(`Title ${CHILD_A}`)).toBeInTheDocument();
  });

  it("reports the selected child session id", async () => {
    mockClient([session(CHILD_A, { parentID: PARENT })]);
    applySessionList(SERVER, [session(PARENT)]);
    const onSelect = renderPanel();

    fireEvent.click(await screen.findByTestId(`subtask-child-${CHILD_A}`));
    expect(onSelect).toHaveBeenCalledWith(CHILD_A);
  });

  it("renders the empty state when there are no children", async () => {
    applySessionList(SERVER, [session(PARENT)]);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("subtask-empty")).toBeInTheDocument());
    expect(screen.getByText("No subtasks yet")).toBeInTheDocument();
  });

  it("merges fetched children into the session store (SSE keeps them fresh)", async () => {
    const client = mockClient([session(CHILD_A, { parentID: PARENT })]);
    applySessionList(SERVER, [session(PARENT)]);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId(`subtask-child-${CHILD_A}`)).toBeInTheDocument());
    // The fetch upserted the child into the global store.
    expect(getServerSessionState(SERVER).sessions[CHILD_A]).toBeDefined();
    expect(client.get).toHaveBeenCalledWith("/session/sess_parent/children", undefined);
  });
});
