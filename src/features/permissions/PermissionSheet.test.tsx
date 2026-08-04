// L2 tests for the permission sheet (TASK-M5-01): renders the queue head
// (permission type, pattern chips, tool context) with a "1 of N" indicator
// for a multi-request queue and an expandable metadata detail; Allow once /
// Always allow / Reject post the right reply and drain the queue; the
// actions lock while a reply POST is in flight; a failed reply surfaces an
// inline error and keeps the request queued (requeue); "Always allow"
// records the remember-memo and a later request with the same pattern is
// auto-replied "always" without showing the card; a store-level dequeue
// (permission.replied event path) advances the queue head; Esc cannot
// dismiss the dialog; the "sheet" variant renders the same card as a
// pinned mobile bottom sheet (TASK-M7-05) with working actions.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { enqueue, dequeue, resetServer as resetPermissionStore } from "../../stores/permission";
import type { PermissionRequest } from "../../services/permission";
import PermissionSheet from "./PermissionSheet";
import { isPatternRemembered, rememberPattern, resetRemembered } from "./remembered";

const { createPermissionServiceMock, getApiClientMock } = vi.hoisted(() => ({
  createPermissionServiceMock: vi.fn(),
  getApiClientMock: vi.fn(),
}));

vi.mock("../../services/permission.js", () => ({
  createPermissionService: createPermissionServiceMock,
}));
vi.mock("../../services/client.js", () => ({ getApiClient: getApiClientMock }));

const SERVER = "srv-perm-sheet";

/** The 1.18.11 metadata type is Record<string, never> (a codegen artifact
 *  for free-form objects); tests build requests with real metadata. */
type RequestOverrides = Partial<Omit<PermissionRequest, "metadata">> & {
  metadata?: Record<string, unknown>;
};

function request(id: string, overrides: RequestOverrides = {}): PermissionRequest {
  return {
    id,
    sessionID: "ses_1",
    permission: "bash",
    patterns: ["pnpm test"],
    metadata: {},
    always: [],
    ...overrides,
  } as PermissionRequest;
}

/** Installs a reply mock resolving to true; returns the mock. */
function mockReply() {
  const reply = vi.fn(async () => true);
  createPermissionServiceMock.mockReturnValue({ list: vi.fn(), reply });
  getApiClientMock.mockReturnValue({});
  return reply;
}

beforeEach(() => {
  resetRemembered();
  resetPermissionStore(SERVER);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PermissionSheet (overlay)", () => {
  it("renders the queue head with permission type, patterns and tool context", () => {
    mockReply();
    enqueue(
      SERVER,
      request("per_1", {
        permission: "bash",
        patterns: ["pnpm test", "git status"],
        tool: { messageID: "msg_m2", callID: "call_c1" },
      }),
    );
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    expect(screen.getByTestId("permission-type").textContent).toBe("bash");
    const patterns = screen.getByTestId("permission-patterns");
    expect(patterns.textContent).toContain("pnpm test");
    expect(patterns.textContent).toContain("git status");
    expect(screen.getByTestId("permission-tool-context").textContent).toBe(
      "message msg_m2 · call call_c1",
    );
    // Single request: no position indicator.
    expect(screen.queryByTestId("permission-queue-position")).toBeNull();
  });

  it("shows a 1-of-N indicator while multiple requests wait and advances the head", () => {
    mockReply();
    enqueue(SERVER, request("per_1"));
    enqueue(SERVER, request("per_2", { permission: "edit", patterns: ["src/a.ts"] }));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    expect(screen.getByTestId("permission-queue-position").textContent).toBe("1 of 2 waiting");
    expect(screen.getByTestId("permission-type").textContent).toBe("bash");

    // Store-level dequeue (the permission.replied event path) advances to
    // the next request; the indicator hides with a single request left.
    dequeue(SERVER, "per_1");
    expect(screen.getByTestId("permission-type").textContent).toBe("edit");
    expect(screen.queryByTestId("permission-queue-position")).toBeNull();
  });

  it("expands and collapses the metadata details", () => {
    mockReply();
    enqueue(SERVER, request("per_1", { metadata: { cwd: "/mock/projects/demo" } }));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    expect(screen.queryByTestId("permission-details")).toBeNull();
    fireEvent.click(screen.getByTestId("permission-details-toggle"));
    expect(screen.getByTestId("permission-details").textContent).toContain("/mock/projects/demo");
    fireEvent.click(screen.getByTestId("permission-details-toggle"));
    expect(screen.queryByTestId("permission-details")).toBeNull();
  });

  it("hides the details toggle when the request carries no metadata", () => {
    mockReply();
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);
    expect(screen.queryByTestId("permission-details-toggle")).toBeNull();
  });

  it("Allow once posts a once reply and drains the queue", async () => {
    const reply = mockReply();
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    fireEvent.click(screen.getByTestId("permission-allow-once"));
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("per_1", "once"));
    await vi.waitFor(() => expect(screen.queryByTestId("permission-type")).toBeNull());
  });

  it("Reject posts a reject reply", async () => {
    const reply = mockReply();
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    fireEvent.click(screen.getByTestId("permission-reject"));
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("per_1", "reject"));
    await vi.waitFor(() => expect(screen.queryByTestId("permission-type")).toBeNull());
  });

  it("Always allow posts an always reply and remembers the pattern", async () => {
    const reply = mockReply();
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    fireEvent.click(screen.getByTestId("permission-allow-always"));
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("per_1", "always"));
    expect(isPatternRemembered(SERVER, request("per_1"))).toBe(true);
    await vi.waitFor(() => expect(screen.queryByTestId("permission-type")).toBeNull());
  });

  it("locks the action buttons while a reply is in flight", async () => {
    let resolveReply!: (value: boolean) => void;
    const reply = vi.fn(() => new Promise<boolean>((resolve) => (resolveReply = resolve)));
    createPermissionServiceMock.mockReturnValue({ list: vi.fn(), reply });
    enqueue(SERVER, request("per_1"));
    enqueue(SERVER, request("per_2", { permission: "edit", patterns: ["src/a.ts"] }));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    fireEvent.click(screen.getByTestId("permission-allow-once"));
    expect(reply).toHaveBeenCalledWith("per_1", "once");
    expect((screen.getByTestId("permission-allow-once") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("permission-allow-always") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId("permission-reject") as HTMLButtonElement).disabled).toBe(true);

    resolveReply(true);
    // The reply drains per_1 and the lock releases for the next request.
    await vi.waitFor(() => expect(screen.getByTestId("permission-type").textContent).toBe("edit"));
    expect((screen.getByTestId("permission-allow-once") as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the request queued with an inline error when the reply fails", async () => {
    const reply = vi
      .fn<(id: string, r: string) => Promise<boolean>>()
      .mockRejectedValueOnce({ status: 404, code: "http", message: "not found", retriable: false })
      .mockResolvedValueOnce(true);
    createPermissionServiceMock.mockReturnValue({ list: vi.fn(), reply });
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    fireEvent.click(screen.getByTestId("permission-allow-once"));
    await vi.waitFor(() => expect(screen.getByTestId("permission-error")).toBeTruthy());
    // Requeue: the card stays on the same request; a retry with another
    // action succeeds.
    expect(screen.getByTestId("permission-type").textContent).toBe("bash");
    fireEvent.click(screen.getByTestId("permission-reject"));
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("per_1", "reject"));
    await vi.waitFor(() => expect(screen.queryByTestId("permission-type")).toBeNull());
  });

  it("auto-replies always to a remembered pattern without showing the card", async () => {
    const reply = mockReply();
    rememberPattern(SERVER, { permission: "bash", patterns: ["pnpm test"] });
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("per_1", "always"));
    // The card never surfaced for the remembered request.
    await vi.waitFor(() => expect(screen.queryByTestId("permission-sheet")).toBeNull());
  });

  it("auto-replies a remembered pattern arriving after a manual decision", async () => {
    const reply = mockReply();
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    fireEvent.click(screen.getByTestId("permission-allow-always"));
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("per_1", "always"));

    // The same pattern is asked again later (e.g. a server restart lost
    // the always rule): auto-replied silently.
    enqueue(SERVER, request("per_2", { tool: { messageID: "m2", callID: "c2" } }));
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("per_2", "always"));
    await vi.waitFor(() => expect(screen.queryByTestId("permission-sheet")).toBeNull());
  });

  it("surfaces the card with the inline error when an auto-reply fails", async () => {
    const reply = vi.fn().mockRejectedValue({
      status: 500,
      code: "http",
      message: "boom",
      retriable: true,
    });
    createPermissionServiceMock.mockReturnValue({ list: vi.fn(), reply });
    rememberPattern(SERVER, { permission: "bash", patterns: ["pnpm test"] });
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    // The silent reply failed: the card appears with the error and the
    // request stays queued for a manual retry.
    await vi.waitFor(() => expect(screen.getByTestId("permission-error")).toBeTruthy());
    expect(screen.getByTestId("permission-type").textContent).toBe("bash");
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("cannot be dismissed with Escape", () => {
    mockReply();
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="overlay" />);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByTestId("permission-type").textContent).toBe("bash");
  });
});

describe("PermissionSheet (sheet variant)", () => {
  it("renders the queue head as a bottom sheet and actions drain the queue", async () => {
    const reply = mockReply();
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="sheet" />);

    // The Sheet panel carries the same test id as the overlay dialog.
    await vi.waitFor(() => expect(screen.getByTestId("permission-sheet")).toBeInTheDocument());
    expect(screen.getByTestId("permission-sheet")).toHaveAttribute("data-snap", "high");
    expect(screen.getByTestId("permission-sheet-scrim")).toBeInTheDocument();
    expect(screen.getByTestId("permission-type").textContent).toBe("bash");

    fireEvent.click(screen.getByTestId("permission-allow-once"));
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("per_1", "once"));
    await vi.waitFor(() => expect(screen.queryByTestId("permission-sheet")).toBeNull());
  });

  it("cannot be dismissed by scrim, Esc or drag-down", async () => {
    mockReply();
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="sheet" />);
    await vi.waitFor(() => expect(screen.getByTestId("permission-sheet")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("permission-sheet-scrim"));
    fireEvent.keyDown(window, { key: "Escape" });
    const panel = screen.getByTestId("permission-sheet");
    fireEvent.pointerDown(panel, { clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientY: 400 });
    fireEvent.pointerUp(window, { clientY: 400 });

    expect(screen.getByTestId("permission-type").textContent).toBe("bash");
  });

  it("auto-replies a remembered pattern without surfacing the sheet", async () => {
    const reply = mockReply();
    rememberPattern(SERVER, { permission: "bash", patterns: ["pnpm test"] });
    enqueue(SERVER, request("per_1"));
    render(() => <PermissionSheet serverId={SERVER} variant="sheet" />);

    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("per_1", "always"));
    await vi.waitFor(() => expect(screen.queryByTestId("permission-sheet")).toBeNull());
  });
});
