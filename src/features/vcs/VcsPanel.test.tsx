// L2 tests for the VCS panel (TASK-M4-08): the branch header + change rows
// (status chip / path / +N -M badges) from the store, the clean-tree empty
// state, the manual refresh refetch, the workspace diff sub-view, the apply
// flow (paste -> confirm dialog -> POST /vcs/apply -> success clears the
// textarea and refreshes status / failure shows the error detail / cancel
// sends nothing), the non-git graceful empty state and the live branch
// update on a `vcs.branch.updated` store write.
//
// Every test uses a fresh server id so the client mocks and store buckets
// stay isolated (same convention as DiffView.test.tsx).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { ApiClient, type Transport, type TransportRequest } from "../../services/client";
import { applyBranch, resetServer as resetVcs } from "../../stores/vcs";
import { setActiveServer } from "../../stores/registry";
import VcsPanel from "./VcsPanel";

const { getApiClientMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
}));

vi.mock("../../services/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/client.js")>();
  return { ...actual, getApiClient: getApiClientMock };
});

let serverSeq = 0;
/** Unique per-test server id (isolates store buckets and mocks). */
function freshServer(): string {
  return `srv-panel-${++serverSeq}`;
}

function httpResponse(body: unknown) {
  return { status: 200, headers: {}, body, bodyText: undefined };
}

const VCS_INFO = { branch: "main", default_branch: "main" };

const STATUS = [
  { file: "src/features/a.ts", additions: 12, deletions: 4, status: "modified" },
  { file: "src/services/b.ts", additions: 64, deletions: 0, status: "added" },
  { file: "src/legacy/deprecated.ts", additions: 0, deletions: 30, status: "deleted" },
];

const WORKSPACE_DIFF = [
  {
    file: "src/features/a.ts",
    patch: [
      "--- a/src/features/a.ts",
      "+++ b/src/features/a.ts",
      "@@ -1,3 +1,4 @@",
      " const a = 1;",
      "-const gone = 2;",
      "+export const added = 2;",
    ].join("\n"),
    additions: 1,
    deletions: 1,
    status: "modified",
  },
];

const PATCH_TEXT = "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-old\n+new\n";

interface RouteStats {
  statusCalls: number;
  applyCalls: { patch: string }[];
  failApply: boolean;
}

/** Injects a client whose transport answers the /vcs family per route. */
function mountPanel(
  serverId: string,
  options: { vcsInfo?: unknown; status?: unknown; diff?: unknown; failApply?: boolean } = {},
): RouteStats {
  const stats: RouteStats = {
    statusCalls: 0,
    applyCalls: [],
    failApply: options.failApply ?? false,
  };
  const requestMock = vi.fn().mockImplementation((input: TransportRequest) => {
    if (input.method === "GET" && input.path === "/vcs") {
      return Promise.resolve(httpResponse(options.vcsInfo ?? VCS_INFO));
    }
    if (input.method === "GET" && input.path === "/vcs/status") {
      stats.statusCalls += 1;
      return Promise.resolve(httpResponse(options.status ?? STATUS));
    }
    if (input.method === "GET" && input.path === "/vcs/diff") {
      return Promise.resolve(httpResponse(options.diff ?? WORKSPACE_DIFF));
    }
    if (input.method === "POST" && input.path === "/vcs/apply") {
      stats.applyCalls.push({ patch: String((input.body as { patch?: unknown }).patch ?? "") });
      return stats.failApply
        ? Promise.reject({ status: 400, code: "http", message: "working tree not clean" })
        : Promise.resolve(httpResponse({ applied: true }));
    }
    return Promise.resolve(httpResponse(undefined));
  });
  const transport: Transport = { request: requestMock as unknown as Transport["request"] };
  getApiClientMock.mockReturnValue(new ApiClient(transport));
  render(() => <VcsPanel serverId={serverId} />);
  return stats;
}

beforeEach(() => {
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue(new ApiClient({ request: vi.fn() }));
});

afterEach(() => {
  for (let i = 1; i <= serverSeq; i += 1) {
    resetVcs(`srv-panel-${i}`);
  }
  setActiveServer(null);
  vi.restoreAllMocks();
});

describe("VcsPanel branch and change list", () => {
  it("renders the branch chip and change rows with status letters and stat badges", async () => {
    const serverId = freshServer();
    mountPanel(serverId);

    await waitFor(() => expect(screen.getByTestId("vcs-branch")).toHaveTextContent("main"));
    expect(screen.getByTestId("vcs-count")).toHaveTextContent("3 changes");

    const rows = screen.getAllByTestId("vcs-change");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("data-status", "modified");
    expect(rows[0].querySelector('[data-testid="vcs-change-chip"]')).toHaveTextContent("M");
    expect(rows[0]).toHaveTextContent("src/features/a.ts");
    expect(rows[0].querySelector('[data-testid="vcs-change-stats"]')).toHaveTextContent("+12 -4");
    expect(rows[1].querySelector('[data-testid="vcs-change-chip"]')).toHaveTextContent("A");
    expect(rows[2].querySelector('[data-testid="vcs-change-chip"]')).toHaveTextContent("D");
    expect(rows[2].querySelector('[data-testid="vcs-change-stats"]')).toHaveTextContent("+0 -30");
  });

  it("shows the clean-tree empty state when status reports no changes", async () => {
    const serverId = freshServer();
    mountPanel(serverId, { status: [] });

    await waitFor(() => expect(screen.getByTestId("vcs-changes-empty")).toBeInTheDocument());
    expect(screen.getByTestId("vcs-changes-empty")).toHaveTextContent("Working tree clean");
  });

  it("refetches branch info and status on the Refresh button", async () => {
    const serverId = freshServer();
    const stats = mountPanel(serverId);

    await waitFor(() => expect(screen.getByTestId("vcs-branch")).toBeInTheDocument());
    expect(stats.statusCalls).toBe(1);

    fireEvent.click(screen.getByTestId("vcs-refresh"));
    await waitFor(() => expect(stats.statusCalls).toBe(2));
  });

  it("updates the branch chip and refetches status on a branch event", async () => {
    const serverId = freshServer();
    const stats = mountPanel(serverId);

    await waitFor(() => expect(screen.getByTestId("vcs-branch")).toHaveTextContent("main"));
    applyBranch(serverId, "feat/x");

    await waitFor(() => expect(screen.getByTestId("vcs-branch")).toHaveTextContent("feat/x"));
    // The version bump triggers a status refetch (checkout changed the tree).
    await waitFor(() => expect(stats.statusCalls).toBe(2));
  });
});

describe("VcsPanel workspace diff", () => {
  it("opens the workspace diff sub-view and Back returns to the change list", async () => {
    const serverId = freshServer();
    mountPanel(serverId);

    await waitFor(() => expect(screen.getByTestId("vcs-branch")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("vcs-diff-button"));

    expect(screen.getByTestId("workspace-diff")).toBeInTheDocument();
    expect(screen.getByText("Workspace diff")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByTestId("diff-file-header").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("src/features/a.ts")).toBeInTheDocument();
    const rows = screen.getAllByTestId("diff-row");
    expect(rows.find((row) => row.getAttribute("data-kind") === "del")).toHaveTextContent(
      "-const gone = 2;",
    );

    fireEvent.click(screen.getByTestId("vcs-diff-back"));
    expect(screen.queryByTestId("workspace-diff")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("vcs-change")).toHaveLength(3);
  });
});

describe("VcsPanel apply flow", () => {
  it("applies a pasted patch after confirmation and refreshes status on success", async () => {
    const serverId = freshServer();
    const stats = mountPanel(serverId);

    await waitFor(() => expect(screen.getByTestId("vcs-apply-input")).toBeInTheDocument());
    fireEvent.input(screen.getByTestId("vcs-apply-input"), { target: { value: PATCH_TEXT } });
    expect(screen.getByTestId("vcs-apply-button")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("vcs-apply-button"));
    expect(screen.getByTestId("vcs-apply-confirm")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("vcs-apply-confirm-btn"));

    // The POST carries the pasted patch; success clears the textarea and
    // bumps the store so status refetches.
    await waitFor(() => expect(stats.applyCalls).toHaveLength(1));
    expect(stats.applyCalls[0].patch).toBe(PATCH_TEXT);
    await waitFor(() => expect(screen.getByTestId("vcs-apply-success")).toBeInTheDocument());
    expect(screen.getByTestId("vcs-apply-success")).toHaveTextContent("status refreshed");
    expect((screen.getByTestId("vcs-apply-input") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByTestId("vcs-apply-confirm")).not.toBeInTheDocument();
    await waitFor(() => expect(stats.statusCalls).toBe(2));
  });

  it("Cancel closes the confirmation without calling the endpoint", async () => {
    const serverId = freshServer();
    const stats = mountPanel(serverId);

    await waitFor(() => expect(screen.getByTestId("vcs-apply-input")).toBeInTheDocument());
    fireEvent.input(screen.getByTestId("vcs-apply-input"), { target: { value: PATCH_TEXT } });
    fireEvent.click(screen.getByTestId("vcs-apply-button"));
    expect(screen.getByTestId("vcs-apply-confirm")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("vcs-apply-cancel"));
    expect(screen.queryByTestId("vcs-apply-confirm")).not.toBeInTheDocument();
    expect(stats.applyCalls).toHaveLength(0);
    expect((screen.getByTestId("vcs-apply-input") as HTMLTextAreaElement).value).toBe(PATCH_TEXT);
  });

  it("disables Apply for an empty patch", async () => {
    const serverId = freshServer();
    mountPanel(serverId);

    await waitFor(() => expect(screen.getByTestId("vcs-apply-button")).toBeDisabled());
  });

  it("shows the error detail inline when the apply fails", async () => {
    const serverId = freshServer();
    mountPanel(serverId, { failApply: true });

    await waitFor(() => expect(screen.getByTestId("vcs-apply-input")).toBeInTheDocument());
    fireEvent.input(screen.getByTestId("vcs-apply-input"), { target: { value: PATCH_TEXT } });
    fireEvent.click(screen.getByTestId("vcs-apply-button"));
    fireEvent.click(screen.getByTestId("vcs-apply-confirm-btn"));

    await waitFor(() => expect(screen.getByTestId("vcs-apply-error")).toBeInTheDocument());
    expect(screen.getByTestId("vcs-apply-error")).toHaveTextContent("working tree not clean");
    expect(screen.queryByTestId("vcs-apply-success")).not.toBeInTheDocument();
  });
});

describe("VcsPanel non-git workspace", () => {
  it("renders the graceful empty state and hides diff/apply actions", async () => {
    const serverId = freshServer();
    mountPanel(serverId, { vcsInfo: {} });

    await waitFor(() => expect(screen.getByTestId("vcs-non-git")).toBeInTheDocument());
    expect(screen.getByTestId("vcs-non-git")).toHaveTextContent("Not a git repository");
    expect(screen.queryByTestId("vcs-branch")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vcs-diff-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vcs-refresh")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vcs-apply")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vcs-change")).not.toBeInTheDocument();
  });
});
