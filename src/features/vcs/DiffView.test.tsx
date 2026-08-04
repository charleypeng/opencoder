// L2 tests for the session diff view (TASK-M4-07): per-file groups with
// path/status/stat badges, unified rows with line numbers and add/del
// coloring, folding of long unchanged runs, the unified/split mode toggle,
// stats-only files without patch content, loading / error + retry / empty
// states, message-id filtering (refetch on filter change) and refetch on a
// session.diff version bump.
//
// Every test uses a fresh server id: the diff view has no module cache, but
// unique ids keep the client mocks and store buckets isolated per test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { ApiClient, type Transport } from "../../services/client";
import { applyDiff, resetServer as resetDiffs } from "../../stores/diff";
import { setActiveServer } from "../../stores/registry";
import DiffView, { type DiffViewProps } from "./DiffView";
import type { SnapshotFileDiff } from "../../services/vcs.js";

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
  return `srv-diff-${++serverSeq}`;
}

function httpResponse(body: unknown) {
  return { status: 200, headers: {}, body, bodyText: undefined };
}

function patchEntry(
  file: string,
  patch: string,
  extras: Partial<SnapshotFileDiff> = {},
): SnapshotFileDiff {
  return {
    file,
    patch,
    additions: 1,
    deletions: 1,
    status: "modified",
    ...extras,
  };
}

const CONTEXT_RICH_PATCH = [
  "--- a/src/auth/login.ts",
  "+++ b/src/auth/login.ts",
  "@@ -1,7 +1,7 @@",
  ' import { auth } from "./api";',
  " const a = 1;",
  " const b = 2;",
  " const c = 3;",
  " const d = 4;",
  " const e = 5;",
  "-const gone = 6;",
  "+export const added = 6;",
  " const tail = 7;",
].join("\n");

/** Standard two-file fixture: one patch file, one stats-only file. */
function diffPayload(): SnapshotFileDiff[] {
  return [
    patchEntry("src/auth/login.ts", CONTEXT_RICH_PATCH),
    { file: "src/auth/token.ts", additions: 8, deletions: 0, status: "added" },
  ];
}

/** Injects a client whose transport answers /session/{id}/diff per query. */
function mountDiff(
  serverId: string,
  answer: (messageId: string | undefined) => unknown,
  props: Partial<DiffViewProps> = {},
): ReturnType<typeof vi.fn> {
  const requestMock = vi
    .fn()
    .mockImplementation((input: { path: string; query?: Record<string, string> }) => {
      const match = /^\/session\/.+\/diff$/.exec(input.path ?? "");
      if (match === null) return Promise.resolve(httpResponse(undefined));
      const messageId = input.query?.messageID;
      return Promise.resolve(httpResponse(answer(messageId)));
    });
  const transport: Transport = { request: requestMock as unknown as Transport["request"] };
  getApiClientMock.mockReturnValue(new ApiClient(transport));
  render(() => (
    <DiffView
      serverId={serverId}
      sessionId="ses_diff"
      messageId={props.messageId}
      mode={props.mode}
    />
  ));
  return requestMock;
}

function diffCalls(
  requestMock: ReturnType<typeof vi.fn>,
): { path: string; messageId: string | undefined }[] {
  return requestMock.mock.calls
    .filter((call) => /^\/session\/.+\/diff$/.test((call[0] as { path: string }).path))
    .map((call) => {
      const query = (call[0] as { query?: Record<string, string> }).query ?? {};
      return { path: (call[0] as { path: string }).path, messageId: query.messageID };
    });
}

beforeEach(() => {
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue(new ApiClient({ request: vi.fn() }));
});

afterEach(() => {
  for (let i = 1; i <= serverSeq; i += 1) {
    resetDiffs(`srv-diff-${i}`);
  }
  setActiveServer(null);
  vi.restoreAllMocks();
});

describe("DiffView rendering", () => {
  it("renders per-file groups with path, stats and status badges", async () => {
    const serverId = freshServer();
    mountDiff(serverId, () => diffPayload());

    await waitFor(() =>
      expect(screen.getAllByTestId("diff-file-header").length).toBeGreaterThan(0),
    );
    const headers = screen.getAllByTestId("diff-file-header");
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveTextContent("src/auth/login.ts");
    expect(headers[0]).toHaveTextContent("+1 -1");
    expect(headers[0].querySelector('[data-testid="diff-file-status"]')).toHaveAttribute(
      "data-status",
      "modified",
    );
    expect(headers[1]).toHaveTextContent("src/auth/token.ts");
    expect(headers[1]).toHaveTextContent("+8 -0");
  });

  it("renders unified rows with line numbers and add/del coloring", async () => {
    const serverId = freshServer();
    mountDiff(serverId, () => diffPayload());

    await waitFor(() => expect(screen.getAllByTestId("diff-row").length).toBeGreaterThan(0));
    const rows = screen.getAllByTestId("diff-row");
    // meta x2, hunk, ctx x5 (folded to 3 visible), del, add, ctx
    expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual([
      "meta",
      "meta",
      "hunk",
      "ctx",
      "ctx",
      "ctx",
      "del",
      "add",
      "ctx",
    ]);
    const del = rows.find((row) => row.getAttribute("data-kind") === "del") as HTMLElement;
    const add = rows.find((row) => row.getAttribute("data-kind") === "add") as HTMLElement;
    expect(del).toHaveClass("bg-danger/15", "text-danger");
    expect(del).toHaveTextContent("-const gone = 6;");
    expect(add).toHaveClass("bg-success/15", "text-success");
    expect(add).toHaveTextContent("+export const added = 6;");
    // Line numbers: the context rows carry old/new numbers.
    const firstCtx = rows.find((row) => row.getAttribute("data-kind") === "ctx") as HTMLElement;
    expect(firstCtx.querySelectorAll("span")[0]).toHaveTextContent("1");
    expect(firstCtx.querySelectorAll("span")[1]).toHaveTextContent("1");
    const delCtx = rows.find((row) => row.getAttribute("data-kind") === "del") as HTMLElement;
    expect(delCtx.querySelectorAll("span")[1]).toHaveTextContent(""); // no new number
  });

  it("renders stats-only files with a content note", async () => {
    const serverId = freshServer();
    mountDiff(serverId, () => diffPayload());

    await waitFor(() => expect(screen.getByTestId("diff-file-no-content")).toBeInTheDocument());
    expect(screen.getByTestId("diff-file-no-content")).toHaveTextContent(
      "Content not available for this diff.",
    );
    const sections = screen.getAllByTestId("diff-file");
    // The stats-only section has no diff rows.
    expect(sections[1].querySelector('[data-testid="diff-row"]')).toBeNull();
  });

  it("folds runs of more than three unchanged lines and expands on click", async () => {
    const serverId = freshServer();
    mountDiff(serverId, () => diffPayload());

    await waitFor(() => expect(screen.getByTestId("diff-fold")).toBeInTheDocument());
    // 6 context lines before the del: 3 visible + fold handle for 3.
    expect(screen.getByTestId("diff-fold")).toHaveTextContent("3 unchanged lines");
    expect(screen.getAllByTestId("diff-row")).toHaveLength(9);

    fireEvent.click(screen.getByTestId("diff-fold"));
    expect(screen.queryByTestId("diff-fold")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("diff-row")).toHaveLength(12);
  });

  it("toggles between unified and split modes", async () => {
    const serverId = freshServer();
    mountDiff(serverId, () => diffPayload(), { mode: "unified" });

    await waitFor(() => expect(screen.getByTestId("diff-unified")).toBeInTheDocument());
    expect(screen.getByTestId("diff-mode-unified")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("diff-mode-split")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByTestId("diff-mode-split"));
    expect(screen.getByTestId("diff-split")).toBeInTheDocument();
    expect(screen.getByTestId("diff-mode-split")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("diff-unified")).not.toBeInTheDocument();

    // Split pairs the del with the following add on one row.
    const pair = screen
      .getAllByTestId("diff-split-row")
      .find((row) => row.querySelector('[data-kind="del"]') !== null) as HTMLElement;
    const cells = pair.querySelectorAll('[data-testid="diff-split-cell"]');
    expect(cells.length).toBe(2);
    expect(cells[0]).toHaveTextContent("-const gone = 6;");
    expect(cells[1]).toHaveTextContent("+export const added = 6;");

    // Back to unified.
    fireEvent.click(screen.getByTestId("diff-mode-unified"));
    expect(screen.getByTestId("diff-unified")).toBeInTheDocument();
  });

  it("seeds the initial mode from the prop", async () => {
    const serverId = freshServer();
    mountDiff(serverId, () => diffPayload(), { mode: "split" });
    await waitFor(() => expect(screen.getByTestId("diff-split")).toBeInTheDocument());
  });
});

describe("DiffView states", () => {
  it("shows a loading state while the fetch is in flight", async () => {
    const serverId = freshServer();
    mountDiff(serverId, () => new Promise(() => {}));
    expect(screen.getByTestId("diff-loading")).toBeInTheDocument();
  });

  it("renders the error banner and retries the fetch", async () => {
    const serverId = freshServer();
    const answer = vi.fn();
    answer.mockRejectedValueOnce({ status: 500 });
    answer.mockResolvedValueOnce(diffPayload());
    mountDiff(serverId, answer);

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("diff-retry"));
    await waitFor(() =>
      expect(screen.getAllByTestId("diff-file-header").length).toBeGreaterThan(0),
    );
  });

  it("renders an empty state for a diff with no changes", async () => {
    const serverId = freshServer();
    mountDiff(serverId, () => []);
    await waitFor(() => expect(screen.getByTestId("diff-empty")).toBeInTheDocument());
    expect(screen.getByTestId("diff-empty")).toHaveTextContent("No changes in this diff");
  });
});

describe("DiffView fetch keys", () => {
  it("passes the message id filter to the request", async () => {
    const serverId = freshServer();
    const requestMock = mountDiff(serverId, () => diffPayload(), { messageId: "msg_02" });

    await waitFor(() =>
      expect(screen.getAllByTestId("diff-file-header").length).toBeGreaterThan(0),
    );
    expect(diffCalls(requestMock)).toEqual([
      { path: "/session/ses_diff/diff", messageId: "msg_02" },
    ]);
  });

  it("refetches when the session.diff version bumps", async () => {
    const serverId = freshServer();
    let fetchCount = 0;
    mountDiff(serverId, () => {
      fetchCount += 1;
      // The refetch (second call) serves the refreshed payload.
      return fetchCount === 1 ? diffPayload() : [patchEntry("src/new.ts", CONTEXT_RICH_PATCH)];
    });

    await waitFor(() => expect(fetchCount).toBe(1));
    await waitFor(() =>
      expect(screen.getAllByTestId("diff-file-header").length).toBeGreaterThan(0),
    );
    // The event replaces the payload and triggers a silent refetch.
    applyDiff(serverId, "ses_diff", [patchEntry("src/new.ts", CONTEXT_RICH_PATCH)]);
    await waitFor(() => expect(screen.getByText("src/new.ts")).toBeInTheDocument());
    expect(fetchCount).toBe(2);
  });
});
