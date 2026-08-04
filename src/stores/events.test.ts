// L1 tests for the event router (TASK-M2-02): the happy-chat mock scenario
// drives the stores to the expected final state, `server.connected` triggers
// a full re-sync, unknown events are ignored, and subscribeToServerEvents
// wires the SSE stream to the router with per-server resets.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SseEvent } from "../services/sse.js";
import { scenarios } from "../../tests/mock-server/scenarios/index.js";
import { applyEvent, subscribeToServerEvents, syncAll } from "./events.js";
import { sessions, resetServer as resetSessions } from "./session.js";
import { messages, resetServer as resetMessages } from "./messages.js";
import { projects, resetServer as resetProjects } from "./project.js";
import { todos, resetServer as resetTodos } from "./todos.js";
import { files, resetServer as resetFiles, setTree } from "./files.js";
import { diffs, resetServer as resetDiffs } from "./diff.js";
import { vcs, resetServer as resetVcs } from "./vcs.js";
import { permissions, resetServer as resetPermissions } from "./permission.js";
import type { Session } from "../services/session.js";
import type { Project } from "../services/project.js";

const { sseSubscribeMock } = vi.hoisted(() => {
  const sseSubscribeMock = vi.fn();
  return { sseSubscribeMock };
});

vi.mock("../services/sse.js", () => ({
  sseSubscribe: sseSubscribeMock,
}));

const SERVER = "srv-evt";

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

function project(id: string, worktree: string): Project {
  return { id, worktree, time: { created: 1, updated: 1 }, sandboxes: [] } as Project;
}

function mockServices() {
  return {
    session: {
      list: vi.fn().mockResolvedValue([session("ses_synced")]),
      statusAll: vi.fn().mockResolvedValue({ ses_synced: { type: "busy" } }),
    },
    project: {
      list: vi.fn().mockResolvedValue([project("p1", "/sync/proj")]),
      current: vi.fn().mockResolvedValue(project("p1", "/sync/proj")),
    },
  };
}

afterEach(() => {
  resetSessions(SERVER);
  resetMessages(SERVER);
  resetProjects(SERVER);
  resetTodos(SERVER);
  resetFiles(SERVER);
  resetDiffs(SERVER);
  resetVcs(SERVER);
  resetPermissions(SERVER);
  sseSubscribeMock.mockReset();
});

describe("applyEvent — happy-chat scenario", () => {
  it("drives session/message/part stores to the scenario's final state", () => {
    const happyChat = scenarios["happy-chat"];
    for (const step of happyChat) {
      if (step.event) applyEvent(SERVER, step.event as SseEvent);
    }

    const store = sessions[SERVER];
    expect(store.sessions["ses_abc123"]).toMatchObject({
      id: "ses_abc123",
      title: "Happy chat",
      agent: "build",
      directory: "/mock/projects/opencode-demo",
    });
    expect(store.statuses["ses_abc123"]).toEqual({ type: "idle" });

    const entry = messages[SERVER]["ses_abc123"];
    expect(entry.info).toMatchObject({ id: "msg_user_001", role: "user" });
    expect(entry.order).toEqual(["prt_text_001", "prt_tool_001"]);
    expect(entry.parts["prt_text_001"]).toMatchObject({
      id: "prt_text_001",
      type: "text",
      text: "Hello! I can help with that. Let me look at the repo structure first. Found 3 files. I will summarize them for you.",
    });
    expect(entry.parts["prt_tool_001"]).toMatchObject({
      id: "prt_tool_001",
      type: "tool",
      state: { status: "completed", output: "src/\ndocs/\n" },
    });
    expect(todos[SERVER]["ses_abc123"]).toEqual([
      { content: "Explore the repo structure", status: "completed", priority: "high" },
      { content: "Summarize the codebase", status: "completed", priority: "medium" },
    ]);
  });
});

describe("applyEvent — edge routes", () => {
  it("maps session.deleted to removeSession + removeMessage", () => {
    applyEvent(SERVER, {
      type: "session.created",
      properties: { sessionID: "ses_x", info: session("ses_x") },
    });
    applyEvent(SERVER, {
      type: "message.updated",
      properties: {
        sessionID: "ses_x",
        info: { id: "m1", sessionID: "ses_x", role: "user", time: { created: 1 } },
      },
    });
    applyEvent(SERVER, {
      type: "session.deleted",
      properties: { sessionID: "ses_x", info: session("ses_x") },
    });
    expect(sessions[SERVER].sessions["ses_x"]).toBeUndefined();
    expect(messages[SERVER]["ses_x"]).toBeUndefined();
  });

  it("maps message.removed to part cleanup for that message", () => {
    applyEvent(SERVER, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_y",
        time: 1,
        part: {
          id: "prt_1",
          sessionID: "ses_y",
          messageID: "msg_1",
          type: "text",
          text: "hello",
        },
      },
    });
    applyEvent(SERVER, {
      type: "message.removed",
      properties: { sessionID: "ses_y", messageID: "msg_1" },
    });
    expect(messages[SERVER]["ses_y"].order).toEqual([]);
  });

  it("maps session.error to an error status with a message", () => {
    applyEvent(SERVER, {
      type: "session.created",
      properties: { sessionID: "ses_z", info: session("ses_z") },
    });
    applyEvent(SERVER, {
      type: "session.error",
      properties: {
        sessionID: "ses_z",
        error: { name: "UnknownError", data: { message: "boom" } },
      },
    });
    expect(sessions[SERVER].statuses["ses_z"]).toEqual({ type: "error", message: "boom" });
  });

  it("ignores unknown and deferred event types", () => {
    applyEvent(SERVER, { type: "project.updated", properties: {} });
    applyEvent(SERVER, { type: "server.connected", properties: {} });
    expect(sessions[SERVER]).toBeUndefined();
    expect(messages[SERVER]).toBeUndefined();
    expect(projects[SERVER]).toBeUndefined();
  });

  it("maps todo.updated with a todos array to the todos store", () => {
    const list = [
      { content: "a", status: "pending", priority: "high" },
      { content: "b", status: "completed", priority: "low" },
    ];
    applyEvent(SERVER, { type: "todo.updated", properties: { sessionID: "ses_t1", todos: list } });
    expect(todos[SERVER]["ses_t1"]).toEqual(list);

    const refreshed = [{ content: "a", status: "completed", priority: "high" }];
    applyEvent(SERVER, {
      type: "todo.updated",
      properties: { sessionID: "ses_t1", todos: refreshed },
    });
    expect(todos[SERVER]["ses_t1"]).toEqual(refreshed);
  });

  it("maps todo.updated with a single todo defensively", () => {
    applyEvent(SERVER, {
      type: "todo.updated",
      properties: {
        sessionID: "ses_t2",
        todos: [{ content: "a", status: "pending", priority: "high" }],
      },
    });
    applyEvent(SERVER, {
      type: "todo.updated",
      properties: {
        sessionID: "ses_t2",
        todo: { content: "a", status: "completed", priority: "high" },
      },
    });
    expect(todos[SERVER]["ses_t2"]).toEqual([
      { content: "a", status: "completed", priority: "high" },
    ]);
  });

  it("ignores todo.updated without a session id or list", () => {
    applyEvent(SERVER, { type: "todo.updated", properties: {} });
    expect(todos[SERVER]).toBeUndefined();
  });

  it("maps project.updated with a projects array to the project store", () => {
    const list = [project("p1", "/a"), project("p2", "/b")];
    applyEvent(SERVER, { type: "project.updated", properties: { projects: list } });
    expect(projects[SERVER].projects).toEqual(list);

    const refreshed = [project("p3", "/c")];
    applyEvent(SERVER, {
      type: "project.directories.updated",
      properties: { projects: refreshed },
    });
    expect(projects[SERVER].projects).toEqual(refreshed);
  });

  it("maps file.watcher.updated to a files-store version bump", () => {
    setTree(SERVER, undefined, [
      {
        name: "a.ts",
        path: "a.ts",
        absolute: "/mock/projects/demo/a.ts",
        type: "file",
        ignored: false,
      },
    ]);
    expect(files[SERVER].version).toBe(0);

    applyEvent(SERVER, {
      type: "file.watcher.updated",
      properties: { file: "a.ts", event: "change" },
    });
    applyEvent(SERVER, {
      type: "file.watcher.updated",
      properties: { file: "b.ts", event: "add" },
    });
    expect(files[SERVER].version).toBe(2);
    // The tree is untouched; the refetch triggered by the version is the
    // source of truth for the delta.
    expect(files[SERVER].tree[0].path).toBe("a.ts");
  });

  it("maps file.edited to a files-store version bump", () => {
    setTree(SERVER, undefined, []);
    applyEvent(SERVER, { type: "file.edited", properties: { file: "a.ts" } });
    expect(files[SERVER].version).toBe(1);
  });

  it("ignores file watcher events without a file path", () => {
    applyEvent(SERVER, { type: "file.watcher.updated", properties: {} });
    expect(files[SERVER]).toBeUndefined();
  });

  it("maps session.diff to the diff store with a version bump", () => {
    const diff = [
      {
        file: "src/a.ts",
        patch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
    ];
    applyEvent(SERVER, { type: "session.diff", properties: { sessionID: "ses_diff", diff } });
    expect(diffs[SERVER]["ses_diff"]).toMatchObject({ version: 1 });
    expect(diffs[SERVER]["ses_diff"].diffs).toEqual(diff);

    // A second event replaces the payload and bumps the version again.
    applyEvent(SERVER, { type: "session.diff", properties: { sessionID: "ses_diff", diff: [] } });
    expect(diffs[SERVER]["ses_diff"]).toMatchObject({ version: 2, diffs: [] });
  });

  it("bumps the version for a session.diff without a payload", () => {
    applyEvent(SERVER, {
      type: "session.diff",
      properties: { sessionID: "ses_diff2", diff: [{ file: "b.ts", additions: 0, deletions: 0 }] },
    });
    applyEvent(SERVER, { type: "session.diff", properties: { sessionID: "ses_diff2" } });
    expect(diffs[SERVER]["ses_diff2"]).toMatchObject({ version: 2 });

    // Unknown sessions are left untouched by refresh-only events.
    applyEvent(SERVER, { type: "session.diff", properties: { sessionID: "ses_unknown" } });
    expect(diffs[SERVER]["ses_unknown"]).toBeUndefined();
  });

  it("ignores session.diff without a session id", () => {
    applyEvent(SERVER, { type: "session.diff", properties: {} });
    expect(diffs[SERVER]).toBeUndefined();
  });

  it("maps vcs.branch.updated to the vcs store with a version bump", () => {
    applyEvent(SERVER, {
      type: "vcs.branch.updated",
      properties: { branch: "feature/x" },
    });
    expect(vcs[SERVER]).toEqual({ branch: "feature/x", changes: [], version: 1 });

    applyEvent(SERVER, {
      type: "vcs.branch.updated",
      properties: { branch: "main" },
    });
    expect(vcs[SERVER]?.branch).toBe("main");
    expect(vcs[SERVER]?.version).toBe(2);
  });

  it("ignores vcs.branch.updated without a branch name", () => {
    applyEvent(SERVER, { type: "vcs.branch.updated", properties: {} });
    applyEvent(SERVER, { type: "vcs.branch.updated", properties: { branch: 7 } });
    expect(vcs[SERVER]).toBeUndefined();
  });

  it("maps permission.asked to the permission queue (deduped by id)", () => {
    applyEvent(SERVER, {
      type: "permission.asked",
      properties: {
        id: "per_1",
        sessionID: "ses_x",
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        tool: { messageID: "m1", callID: "c1" },
      },
    });
    expect(permissions[SERVER].queue).toEqual([
      {
        id: "per_1",
        sessionID: "ses_x",
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        tool: { messageID: "m1", callID: "c1" },
      },
    ]);

    // A duplicate event for the same request is ignored.
    applyEvent(SERVER, {
      type: "permission.asked",
      properties: {
        id: "per_1",
        sessionID: "ses_x",
        permission: "edit",
        patterns: ["src/a.ts"],
        metadata: {},
        always: [],
      },
    });
    expect(permissions[SERVER].queue).toHaveLength(1);
    expect(permissions[SERVER].queue[0].permission).toBe("bash");
  });

  it("ignores permission.asked without an id or permission", () => {
    applyEvent(SERVER, { type: "permission.asked", properties: {} });
    applyEvent(SERVER, { type: "permission.asked", properties: { id: "per_1" } });
    expect(permissions[SERVER]).toBeUndefined();
  });

  it("maps permission.replied to a queue dequeue by requestID", () => {
    applyEvent(SERVER, {
      type: "permission.asked",
      properties: {
        id: "per_1",
        sessionID: "ses_x",
        permission: "bash",
        patterns: [],
        metadata: {},
        always: [],
      },
    });
    applyEvent(SERVER, {
      type: "permission.asked",
      properties: {
        id: "per_2",
        sessionID: "ses_x",
        permission: "edit",
        patterns: [],
        metadata: {},
        always: [],
      },
    });
    applyEvent(SERVER, {
      type: "permission.replied",
      properties: { sessionID: "ses_x", requestID: "per_1", reply: "once" },
    });
    expect(permissions[SERVER].queue.map((request) => request.id)).toEqual(["per_2"]);

    // Replying to an unknown request is a no-op.
    const version = permissions[SERVER].version;
    applyEvent(SERVER, {
      type: "permission.replied",
      properties: { sessionID: "ses_x", requestID: "per_nope", reply: "always" },
    });
    expect(permissions[SERVER].version).toBe(version);
  });

  it("ignores permission.replied without a requestID", () => {
    applyEvent(SERVER, { type: "permission.replied", properties: {} });
    applyEvent(SERVER, { type: "permission.replied", properties: { reply: "once" } });
    expect(permissions[SERVER]).toBeUndefined();
  });
});

describe("syncAll", () => {
  it("pulls and applies session list, status map, projects and current directory", async () => {
    const services = mockServices();
    const result = await syncAll(SERVER, "/sync/proj", services);

    expect(services.session.list).toHaveBeenCalledWith("/sync/proj");
    expect(services.project.current).toHaveBeenCalledWith("/sync/proj");
    expect(result).toEqual({
      sessions: [session("ses_synced")],
      statuses: { ses_synced: { type: "busy" } },
      projects: [project("p1", "/sync/proj")],
      current: "/sync/proj",
    });

    expect(sessions[SERVER].order).toEqual(["ses_synced"]);
    expect(sessions[SERVER].statuses).toEqual({ ses_synced: { type: "busy" } });
    expect(projects[SERVER].projects).toEqual([project("p1", "/sync/proj")]);
    expect(projects[SERVER].current).toBe("/sync/proj");
  });
});

describe("subscribeToServerEvents", () => {
  it("subscribes, resets per-server state and re-syncs on server.connected", async () => {
    let onEvent: ((event: SseEvent) => void) | undefined;
    sseSubscribeMock.mockImplementation(
      async (_id: string, _dir: string | undefined, handler: (event: SseEvent) => void) => {
        onEvent = handler;
        return async () => {};
      },
    );

    const services = mockServices();
    const result = await subscribeToServerEvents(SERVER, () => "/sync/proj", { services });

    expect(sseSubscribeMock).toHaveBeenCalledWith(SERVER, "/sync/proj", expect.any(Function));
    expect(onEvent).toBeDefined();

    // Stale per-server state exists before the re-connect.
    applyEvent(SERVER, {
      type: "session.created",
      properties: { sessionID: "ses_stale", info: session("ses_stale") },
    });
    applyEvent(SERVER, {
      type: "todo.updated",
      properties: {
        sessionID: "ses_stale",
        todos: [{ content: "a", status: "pending", priority: "high" }],
      },
    });
    applyEvent(SERVER, {
      type: "session.diff",
      properties: {
        sessionID: "ses_stale",
        diff: [{ file: "a.ts", additions: 1, deletions: 0 }],
      },
    });
    applyEvent(SERVER, { type: "vcs.branch.updated", properties: { branch: "stale" } });
    applyEvent(SERVER, {
      type: "permission.asked",
      properties: {
        id: "per_stale",
        sessionID: "ses_stale",
        permission: "bash",
        patterns: [],
        metadata: {},
        always: [],
      },
    });
    setTree(SERVER, undefined, []);
    expect(sessions[SERVER].sessions["ses_stale"]).toBeDefined();
    expect(todos[SERVER]["ses_stale"]).toBeDefined();
    expect(diffs[SERVER]["ses_stale"]).toBeDefined();
    expect(vcs[SERVER]).toBeDefined();
    expect(permissions[SERVER]).toBeDefined();
    expect(files[SERVER]).toBeDefined();

    onEvent?.({ type: "server.connected", properties: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Reset cleared the stale bucket, then syncAll applied the fresh list.
    expect(sessions[SERVER].order).toEqual(["ses_synced"]);
    expect("ses_stale" in sessions[SERVER].sessions).toBe(false);
    expect(projects[SERVER].current).toBe("/sync/proj");
    expect(todos[SERVER]).toBeUndefined();
    expect(diffs[SERVER]).toBeUndefined();
    expect(vcs[SERVER]).toBeUndefined();
    expect(permissions[SERVER]).toBeUndefined();
    expect(files[SERVER]).toBeUndefined();

    // Events keep flowing after the re-sync.
    onEvent?.({
      type: "message.part.delta",
      properties: {
        sessionID: "ses_synced",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "hi",
      },
    });
    expect((messages[SERVER]["ses_synced"].parts["p1"] as { text: string }).text).toBe("hi");

    // Manual sync is exposed.
    await result.sync();
    expect(services.session.list).toHaveBeenCalledTimes(2);

    await result.unsubscribe();
  });

  it("returns a working unsubscribe", async () => {
    const unsubscribe = vi.fn(async () => {});
    sseSubscribeMock.mockResolvedValue(unsubscribe);
    const result = await subscribeToServerEvents(SERVER, () => undefined, {
      services: mockServices(),
    });
    await result.unsubscribe();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
