// Automatic session titles (settings > config > global > "AI generated
// title", TASK-UI-01 follow-up): when enabled, a newly created session
// (server default title "New session - <ts>" / forked "Child session - <ts>")
// is renamed from its FIRST exchange — the first user message's text,
// single-lined and truncated like the opencode TUI — via PATCH /session,
// once per session. The toggle is a CLIENT preference (localStorage): the
// 1.18.11 Config schema has no title-generation key and the server rejects
// unknown keys (additionalProperties: false), so it is never written to
// opencode.json.

import { createEffect, createRoot } from "solid-js";
import { getApiClient } from "../../services/client";
import { createSessionService } from "../../services/session";
import {
  type Message,
  type Part,
  type SessionMessages,
  getServerMessages,
} from "../../stores/messages";
import { getServerSessionState, upsertSession } from "../../stores/session";

const AUTOTITLE_STORAGE_KEY = "oc-autotitle";

/** Reads the preference; absent/malformed storage falls back to ON. */
export function readAutoTitleEnabled(): boolean {
  try {
    return localStorage.getItem(AUTOTITLE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Persists the preference (localStorage only — see header comment). */
export function setAutoTitleEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOTITLE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Storage unavailable: the preference stays in-memory for the session.
  }
}

/** The server's default-title shape (mirrors the 1.18.11 session service:
 *  "New session - <ISO>" for parents, "Child session - <ISO>" for forks). */
const DEFAULT_TITLE_RE =
  /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isDefaultTitle(title: string | undefined): boolean {
  return typeof title === "string" && DEFAULT_TITLE_RE.test(title);
}

/** The suggested title: the FIRST user message's text parts, joined,
 *  single-lined and truncated (50 chars, like the opencode TUI). */
export function titleFromFirstMessage(entry: SessionMessages): string | undefined {
  const first = Object.values(entry.infos)
    .filter((message) => message.role === "user")
    .sort((a, b) => a.time.created - b.time.created)[0];
  if (first === undefined) return undefined;
  const partIds = entry.messageParts[first.id] ?? [];
  const text = partIds
    .map((partId) => entry.parts[partId])
    .filter((part): part is Part & { type: "text" } => part?.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return undefined;
  return text.length > 50 ? `${text.slice(0, 50)}…` : text;
}

/** Watches the server's message tables and titles every default-titled
 *  session once its first exchange completes (a user message and an
 *  assistant message exist). Runs while the toggle is on; failures are
 *  silent. Returns a dispose function. */
export function startAutoTitler(serverId: string): () => void {
  const titled = new Set<string>();
  return createRoot((dispose) => {
    createEffect(() => {
      if (!readAutoTitleEnabled()) return;
      const table = getServerMessages(serverId);
      const sessions = getServerSessionState(serverId).sessions;
      for (const sessionId of Object.keys(table)) {
        if (titled.has(sessionId)) continue;
        const session = sessions[sessionId];
        if (session === undefined || !isDefaultTitle(session.title)) continue;
        const infos = Object.values(table[sessionId].infos);
        const hasUser = infos.some((message) => message.role === "user");
        const hasAssistant = infos.some((message) => message.role === "assistant");
        if (!hasUser || !hasAssistant) continue;
        titled.add(sessionId);
        const title = titleFromFirstMessage(table[sessionId]);
        if (title === undefined) continue;
        void createSessionService(getApiClient())
          .update(sessionId, { title })
          .then((updated) => upsertSession(serverId, updated))
          .catch(() => undefined);
      }
    });
    return dispose;
  });
}

export type { Message };
