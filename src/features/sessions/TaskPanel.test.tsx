// L2 tests for the composer task panel (TaskPanel): the collapsible
// surface above the chat composer. Covers the child-session group
// (rows render from the session store, clicking selects the child) and
// the back affordance shown while the active session is itself a child
// (the auto-expand/collapse and todo rendering are covered by the
// DesktopShell tests).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import TaskPanel from "./TaskPanel";
import type { Session } from "../../services/session";
import { resetServer as resetSessions, upsertSession } from "../../stores/session";

const { getApiClientMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
}));

vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-taskpanel";
const PARENT = "ses_parent";
const CHILD_A = "ses_child_a";
const CHILD_B = "ses_child_b";
const DEMO_DIR = "/mock/projects/opencode-demo";

function sessionFixture(id: string, parentID?: string): Session {
  return {
    id,
    slug: id,
    projectID: "project-mock-1",
    directory: DEMO_DIR,
    title: `Session ${id}`,
    agent: "build",
    model: { id: "gpt-5", providerID: "openai" },
    version: "1.18.11",
    time: { created: 1, updated: 1 },
    ...(parentID !== undefined ? { parentID } : {}),
  } as Session;
}

beforeEach(() => {
  resetSessions(SERVER);
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue({
    get: vi.fn(async () => []),
    post: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  });
});

describe("TaskPanel children group", () => {
  it("renders child sessions and selects one on click", async () => {
    upsertSession(SERVER, sessionFixture(PARENT));
    upsertSession(SERVER, sessionFixture(CHILD_A, PARENT));
    upsertSession(SERVER, sessionFixture(CHILD_B, PARENT));
    const onSelect = vi.fn();

    render(() => (
      <TaskPanel
        serverId={SERVER}
        sessionId={PARENT}
        onSelectSession={onSelect}
        onBackToParent={vi.fn()}
      />
    ));

    // Children alone make the panel appear; the group toggle shows the count.
    const panel = await screen.findByTestId("task-panel");
    expect(panel).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("task-panel-children-count")).toHaveTextContent("2");

    // Rows are hidden until the group is expanded.
    expect(screen.queryByTestId(`task-panel-child-${CHILD_A}`)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("task-panel-children-toggle"));

    const row = await screen.findByTestId(`task-panel-child-${CHILD_A}`);
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(CHILD_A);
  });
});

describe("TaskPanel back affordance", () => {
  it("shows the back button while the active session is a child and returns to the parent", async () => {
    upsertSession(SERVER, sessionFixture(PARENT));
    upsertSession(SERVER, sessionFixture(CHILD_A, PARENT));
    const onBack = vi.fn();

    render(() => (
      <TaskPanel
        serverId={SERVER}
        sessionId={CHILD_A}
        onSelectSession={vi.fn()}
        onBackToParent={onBack}
      />
    ));

    // A child with no todos of its own still shows the panel (its parent
    // relationship keeps it meaningful) with the back affordance.
    const back = await screen.findByTestId("task-panel-back");
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("hides the back button for a top-level session", async () => {
    upsertSession(SERVER, sessionFixture(PARENT));
    render(() => (
      <TaskPanel
        serverId={SERVER}
        sessionId={PARENT}
        onSelectSession={vi.fn()}
        onBackToParent={vi.fn()}
      />
    ));

    // No todos and no children → nothing renders at all.
    await waitFor(() => expect(screen.queryByTestId("task-panel")).not.toBeInTheDocument());
  });
});
