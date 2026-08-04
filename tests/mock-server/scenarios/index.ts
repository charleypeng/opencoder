// Scenario DSL for SSE replay (docs/testing.md §2.2).
//
// A scenario is a timed timeline: each entry schedules an SSE event (or a
// connection drop) at a millisecond offset from the stream start. Events are
// full OpenCode event envelopes ({ id, type, properties }) matching the
// shapes in docs/openapi_v1.18.11.json. IDs are shared across a scenario so
// the payloads stay coherent (session ses_abc123, message msg_*, part prt_*).

export interface ScenarioEvent {
  // Milliseconds after the stream starts.
  at: number;
  // Full SSE event envelope to emit; absent when `drop` is set.
  event?: unknown;
  // Close the connection abruptly at `at` (no terminal event), so clients
  // can exercise reconnect handling.
  drop?: boolean;
}

export type ScenarioMap = Record<string, ScenarioEvent[]>;

const SESSION_ID = "ses_abc123";
const MSG_USER = "msg_user_001";
const MSG_ASSISTANT = "msg_asst_001";
const PART_TEXT = "prt_text_001";
const PART_TOOL = "prt_tool_001";
const CALL_ID = "call_mock_001";
const PERMISSION_ID = "per_req_001";
const QUESTION_ID = "que_req_001";
const DIRECTORY = "/mock/projects/opencode-demo";
const NOW = 1_750_000_000_000;

// Event ids must match the ^evt_ pattern; keep them unique per scenario run.
let sequence = 0;
function event(type: string, properties: Record<string, unknown>): Record<string, unknown> {
  sequence += 1;
  return { id: `evt_${String(sequence).padStart(4, "0")}`, type, properties };
}

const SESSION_INFO: Record<string, unknown> = {
  id: SESSION_ID,
  slug: "happy-chat",
  projectID: "project-mock-1",
  directory: DIRECTORY,
  title: "Happy chat",
  agent: "build",
  model: { id: "gpt-5", providerID: "openai" },
  version: "1.18.11",
  time: { created: NOW, updated: NOW },
};

// Todos have no id in the 1.18.11 schema; they are keyed by content so the
// follow-up todo.updated events stay coherent (same items, new statuses).
const TODO_EXPLORE = "Explore the repo structure";
const TODO_SUMMARIZE = "Summarize the codebase";

function todo(content: string, status: string, priority: string): Record<string, unknown> {
  return { content, status, priority };
}

const USER_MESSAGE: Record<string, unknown> = {
  id: MSG_USER,
  sessionID: SESSION_ID,
  role: "user",
  time: { created: NOW },
  agent: "build",
  model: { providerID: "openai", modelID: "gpt-5" },
  summary: { title: "Explain the codebase", diffs: [] },
};

function textPart(text: string): Record<string, unknown> {
  return {
    id: PART_TEXT,
    sessionID: SESSION_ID,
    messageID: MSG_ASSISTANT,
    type: "text",
    text,
    time: { start: NOW, end: NOW },
  };
}

function toolPart(status: "running" | "completed"): Record<string, unknown> {
  return {
    id: PART_TOOL,
    sessionID: SESSION_ID,
    messageID: MSG_ASSISTANT,
    type: "tool",
    callID: CALL_ID,
    tool: "bash",
    state:
      status === "running"
        ? { status, input: { command: "ls" }, time: { start: NOW } }
        : {
            status,
            input: { command: "ls" },
            output: "src/\ndocs/\n",
            title: "bash",
            metadata: {},
            time: { start: NOW, end: NOW },
          },
  };
}

// Global events are wrapped in the GlobalEvent envelope (directory + payload).
function globalEvent(type: string, properties: Record<string, unknown>): unknown {
  return { directory: DIRECTORY, payload: event(type, properties) };
}

export const scenarios: ScenarioMap = {
  // Core happy path: session.created -> user message -> assistant text
  // deltas -> tool call -> tool result -> session idle.
  "happy-chat": [
    { at: 0, event: event("session.created", { sessionID: SESSION_ID, info: SESSION_INFO }) },
    {
      at: 150,
      event: event("session.status", { sessionID: SESSION_ID, status: { type: "busy" } }),
    },
    { at: 300, event: event("message.updated", { sessionID: SESSION_ID, info: USER_MESSAGE }) },
    {
      at: 500,
      event: event("message.part.updated", {
        sessionID: SESSION_ID,
        part: textPart("Hello! I can help with that."),
        time: NOW,
      }),
    },
    {
      at: 800,
      event: event("message.part.delta", {
        sessionID: SESSION_ID,
        messageID: MSG_ASSISTANT,
        partID: PART_TEXT,
        field: "text",
        delta: " Let me look at the repo structure first.",
      }),
    },
    {
      at: 1200,
      event: event("message.part.updated", {
        sessionID: SESSION_ID,
        part: toolPart("running"),
        time: NOW,
      }),
    },
    {
      at: 1800,
      event: event("message.part.updated", {
        sessionID: SESSION_ID,
        part: toolPart("completed"),
        time: NOW,
      }),
    },
    {
      at: 2200,
      event: event("message.part.delta", {
        sessionID: SESSION_ID,
        messageID: MSG_ASSISTANT,
        partID: PART_TEXT,
        field: "text",
        delta: " Found 3 files. I will summarize them for you.",
      }),
    },
    {
      at: 2300,
      event: event("todo.updated", {
        sessionID: SESSION_ID,
        todos: [
          todo(TODO_EXPLORE, "in_progress", "high"),
          todo(TODO_SUMMARIZE, "pending", "medium"),
        ],
      }),
    },
    {
      at: 2450,
      event: event("todo.updated", {
        sessionID: SESSION_ID,
        todos: [
          todo(TODO_EXPLORE, "completed", "high"),
          todo(TODO_SUMMARIZE, "in_progress", "medium"),
        ],
      }),
    },
    {
      at: 2550,
      event: event("todo.updated", {
        sessionID: SESSION_ID,
        todos: [
          todo(TODO_EXPLORE, "completed", "high"),
          todo(TODO_SUMMARIZE, "completed", "medium"),
        ],
      }),
    },
    {
      at: 2600,
      event: event("session.status", { sessionID: SESSION_ID, status: { type: "idle" } }),
    },
    { at: 2800, event: event("session.idle", { sessionID: SESSION_ID }) },
  ],

  // Permission round-trip: busy -> permission.asked -> permission.replied -> idle.
  "permission-flow": [
    { at: 0, event: event("session.created", { sessionID: SESSION_ID, info: SESSION_INFO }) },
    {
      at: 150,
      event: event("session.status", { sessionID: SESSION_ID, status: { type: "busy" } }),
    },
    {
      at: 400,
      event: event("permission.asked", {
        id: PERMISSION_ID,
        sessionID: SESSION_ID,
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        tool: { messageID: MSG_ASSISTANT, callID: CALL_ID },
      }),
    },
    {
      at: 900,
      event: event("permission.replied", {
        sessionID: SESSION_ID,
        requestID: PERMISSION_ID,
        reply: "once",
      }),
    },
    {
      at: 1200,
      event: event("session.status", { sessionID: SESSION_ID, status: { type: "idle" } }),
    },
    { at: 1400, event: event("session.idle", { sessionID: SESSION_ID }) },
  ],

  // Question round-trip: busy -> question.asked -> question.replied -> idle.
  "question-flow": [
    { at: 0, event: event("session.created", { sessionID: SESSION_ID, info: SESSION_INFO }) },
    {
      at: 150,
      event: event("session.status", { sessionID: SESSION_ID, status: { type: "busy" } }),
    },
    {
      at: 400,
      event: event("question.asked", {
        id: QUESTION_ID,
        sessionID: SESSION_ID,
        questions: [
          {
            question: "Which approach should I take for the refactor?",
            header: "Refactor approach",
            options: [
              { label: "Incremental", description: "Small steps, keep tests green" },
              { label: "Big bang", description: "Rewrite the module in one pass" },
            ],
            multiple: false,
            custom: true,
          },
        ],
      }),
    },
    {
      at: 1000,
      event: event("question.replied", {
        sessionID: SESSION_ID,
        requestID: QUESTION_ID,
        answers: ["Incremental"],
      }),
    },
    {
      at: 1300,
      event: event("session.status", { sessionID: SESSION_ID, status: { type: "idle" } }),
    },
    { at: 1500, event: event("session.idle", { sessionID: SESSION_ID }) },
  ],

  // Streams a few events, then drops the connection mid-stream (no
  // terminal event) so clients can exercise reconnect handling.
  "sse-drop": [
    { at: 0, event: event("session.created", { sessionID: SESSION_ID, info: SESSION_INFO }) },
    {
      at: 150,
      event: event("session.status", { sessionID: SESSION_ID, status: { type: "busy" } }),
    },
    {
      at: 400,
      event: event("message.part.updated", {
        sessionID: SESSION_ID,
        part: textPart("Working on it"),
        time: NOW,
      }),
    },
    { at: 700, drop: true },
  ],

  // Global events (GlobalEvent envelopes) for /global/event. The stream
  // never terminates on its own.
  "global-events": [
    {
      at: 0,
      event: globalEvent("project.updated", {
        id: "project-mock-1",
        worktree: DIRECTORY,
        name: "opencode-demo",
        time: { created: NOW, updated: NOW },
        sandboxes: [],
      }),
    },
    { at: 1000, event: globalEvent("catalog.updated", {}) },
    { at: 2000, event: globalEvent("models-dev.refreshed", {}) },
  ],
};
