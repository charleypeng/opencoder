// L2 tests for the patch part (TASK-M3-02): header with short hash and
// total file count, one row per patched file, and the inline diff
// expansion — clicking a row fetches GET /session/{id}/diff (message-
// filtered) once, renders the shared DiffFileGroup for the file's patch,
// and shows loading / error / empty states. Also a snapshot of the
// fixture's patch part.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { ApiClient, type Transport } from "../../../services/client";
import PatchPart, { type PatchPartData } from "./PatchPart";
import allPartsFixtureJson from "../../../../tests/fixtures/message.stream.all-parts.json";

const { getApiClientMock } = vi.hoisted(() => ({
  getApiClientMock: vi.fn(),
}));

vi.mock("../../../services/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/client.js")>();
  return { ...actual, getApiClient: getApiClientMock };
});

const HASH = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

function patchPart(files: string[]): PatchPartData {
  return {
    id: "prt_patch",
    sessionID: "sess_1",
    messageID: "msg_1",
    type: "patch",
    hash: HASH,
    files,
  } as PatchPartData;
}

const LOGIN_PATCH = [
  "--- a/src/auth/login.ts",
  "+++ b/src/auth/login.ts",
  "@@ -1,14 +1,28 @@",
  ' import { auth } from "./api";',
  "+export function login(username: string, password: string): Promise<string> {",
  "+  return auth.login(username, password);",
  "+}",
].join("\n");

function diffPayload() {
  return [
    {
      file: "src/auth/login.ts",
      patch: LOGIN_PATCH,
      additions: 3,
      deletions: 0,
      status: "modified",
    },
    { file: "src/auth/token.ts", additions: 8, deletions: 0, status: "added" },
  ];
}

/** Injects a client whose transport answers /session/{id}/diff. */
function requestMockFor(answer: () => unknown): ReturnType<typeof vi.fn> {
  const requestMock = vi.fn().mockImplementation((input: { path: string }) => {
    if (/^\/session\/.+\/diff$/.test(input.path ?? "")) {
      return Promise.resolve({ status: 200, headers: {}, body: answer(), bodyText: undefined });
    }
    return Promise.resolve({ status: 404, headers: {}, body: undefined, bodyText: undefined });
  });
  const transport: Transport = { request: requestMock as unknown as Transport["request"] };
  getApiClientMock.mockReturnValue(new ApiClient(transport));
  return requestMock;
}

beforeEach(() => {
  getApiClientMock.mockReset();
  getApiClientMock.mockReturnValue(new ApiClient({ request: vi.fn() }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PatchPart", () => {
  it("renders the header with short hash and file count", () => {
    render(() => <PatchPart part={patchPart(["src/auth/login.ts", "src/auth/session.ts"])} />);
    const card = screen.getByTestId("patch-part");
    expect(card).toHaveTextContent("Patch");
    expect(screen.getByTestId("patch-hash")).toHaveTextContent("a1b2c3d");
    expect(screen.getByTestId("patch-count")).toHaveTextContent("2 files");
  });

  it("renders one row per patched file", () => {
    render(() => <PatchPart part={patchPart(["src/auth/login.ts", "src/auth/session.ts"])} />);
    const rows = screen.getAllByTestId("patch-file");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("src/auth/login.ts");
    expect(rows[1]).toHaveTextContent("src/auth/session.ts");
  });

  it("expands a file's diff on row click (fetched once per card)", async () => {
    const requestMock = requestMockFor(() => diffPayload());
    render(() => <PatchPart part={patchPart(["src/auth/login.ts", "src/auth/session.ts"])} />);

    fireEvent.click(screen.getAllByTestId("patch-file")[0]);
    // The fetch is message-filtered.
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    const call = requestMock.mock.calls.find((c) =>
      /^\/session\/.+\/diff$/.test((c[0] as { path: string }).path ?? ""),
    );
    expect((call?.[0] as { query?: Record<string, string> }).query?.messageID).toBe("msg_1");

    // The shared diff group renders the file's patch with colored rows.
    await waitFor(() =>
      expect(screen.getByTestId("diff-file-header")).toHaveTextContent("src/auth/login.ts"),
    );
    expect(screen.getByTestId("diff-file-stats")).toHaveTextContent("+3-0");
    const rows = screen.getAllByTestId("diff-row");
    expect(rows.some((row) => row.textContent?.includes("export function login"))).toBe(true);

    // Clicking the same row again collapses the diff.
    fireEvent.click(screen.getAllByTestId("patch-file")[0]);
    await waitFor(() => expect(screen.queryByTestId("diff-file-header")).toBeNull());

    // Re-expanding does NOT refetch (payload cached per card).
    const before = requestMock.mock.calls.length;
    fireEvent.click(screen.getAllByTestId("patch-file")[0]);
    await waitFor(() => expect(screen.getByTestId("diff-file-header")).not.toBeNull());
    expect(requestMock.mock.calls.length).toBe(before);
  });

  it("shows a loading state while the diff fetch is pending", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    requestMockFor(() => new Promise((resolve) => (resolveFetch = resolve)));
    render(() => <PatchPart part={patchPart(["src/auth/login.ts"])} />);

    fireEvent.click(screen.getByTestId("patch-file"));
    expect(screen.getByTestId("patch-diff-loading")).not.toBeNull();
    resolveFetch?.(diffPayload());
    await waitFor(() => expect(screen.queryByTestId("patch-diff-loading")).toBeNull());
  });

  it("shows an error state when the diff fetch fails", async () => {
    requestMockFor(() => Promise.reject(new Error("server exploded")));
    render(() => <PatchPart part={patchPart(["src/auth/login.ts"])} />);

    fireEvent.click(screen.getByTestId("patch-file"));
    await waitFor(() =>
      expect(screen.getByTestId("patch-diff-error")).toHaveTextContent("server exploded"),
    );
  });

  it("shows an empty state when the file is not in the diff payload", async () => {
    requestMockFor(() => diffPayload());
    render(() => <PatchPart part={patchPart(["src/auth/session.ts"])} />);

    fireEvent.click(screen.getByTestId("patch-file"));
    await waitFor(() => expect(screen.getByTestId("patch-diff-empty")).not.toBeNull());
  });
});

describe("PatchPart snapshot", () => {
  it("matches the fixture's patch part", () => {
    const fixturePart = allPartsFixtureJson.parts.find((part) => part.id === "prt_p10") as
      PatchPartData | undefined;
    expect(fixturePart).toBeDefined();
    const { container } = render(() => <PatchPart part={fixturePart as PatchPartData} />);
    expect(container).toMatchSnapshot();
  });
});
