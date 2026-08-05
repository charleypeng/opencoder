// Frontend log forwarding (TASK-M9-07): when the `oc-diagnostics` pref
// `forwardLogs` is on, captured error/warn entries are flushed to the
// server as POST /log entries ({ service: "opencoder-webview", level,
// message }). Flush triggers: the queue reaches 20 entries, a 30s timer
// while the queue is non-empty, and a stop (toggling the pref off drains
// the queue first). Entries are deduped by (level, message) within one
// flush batch — repeated identical errors (e.g. a polling loop) would
// otherwise spam the server log. A failed flush drops the batch: the
// server log is best-effort, retrying a full queue would stall the UI.

import { getApiClient } from "../../../services/client.js";
import { createLogService } from "../../../services/log.js";
import { subscribeToLogEntries, type CapturedLogEntry } from "./logCapture.js";

export interface DiagnosticsPrefs {
  /** Whether captured frontend logs are forwarded to the server. */
  forwardLogs?: boolean;
}

const KEY = "oc-diagnostics";
const FLUSH_BATCH = 20;
const FLUSH_INTERVAL_MS = 30_000;
const SERVICE = "opencoder-webview";

/** Reads the persisted diagnostics prefs; malformed payloads yield {}. */
export function loadDiagnosticsPrefs(): DiagnosticsPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as Partial<DiagnosticsPrefs>;
    if (parsed === null || typeof parsed !== "object") return {};
    const prefs: DiagnosticsPrefs = {};
    if (typeof parsed.forwardLogs === "boolean") prefs.forwardLogs = parsed.forwardLogs;
    return prefs;
  } catch {
    return {};
  }
}

/** Persists the diagnostics prefs; storage failures are swallowed. */
export function saveDiagnosticsPrefs(prefs: DiagnosticsPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: nothing to persist, nothing to report.
  }
}

/** Whether log forwarding is enabled (default: off). */
export function forwardLogsEnabled(): boolean {
  return loadDiagnosticsPrefs().forwardLogs === true;
}

let timer: ReturnType<typeof setInterval> | undefined;
let unsubscribe: (() => void) | undefined;
const queue: CapturedLogEntry[] = [];
const dedupe = new Set<string>();

/** Sends one batch of entries to the server; failures drop the batch. */
function flush(): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  dedupe.clear();
  const service = createLogService(getApiClient());
  for (const entry of batch) {
    void service
      .write({ service: SERVICE, level: entry.level, message: entry.message })
      .catch(() => {
        // Best-effort forwarding: an unreachable server must never surface
        // an unhandled rejection; the batch is dropped (retried later only
        // if the same error is captured again).
      });
  }
}

/** Starts forwarding captured entries on the flush schedule. */
export function startLogForwarding(): () => void {
  if (unsubscribe !== undefined) return stopLogForwarding;
  unsubscribe = subscribeToLogEntries((entry) => {
    const key = `${entry.level}:${entry.message}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    queue.push(entry);
    if (queue.length >= FLUSH_BATCH) flush();
  });
  timer = setInterval(flush, FLUSH_INTERVAL_MS);
  return stopLogForwarding;
}

/** Stops forwarding; a non-empty queue is drained before the timer stops. */
export function stopLogForwarding(): void {
  if (unsubscribe === undefined) return;
  flush();
  unsubscribe();
  unsubscribe = undefined;
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

/**
 * Turns log forwarding on or off: persists the pref and starts/stops the
 * forwarder so the stored value always matches the running state.
 */
export function setLogForwarding(enabled: boolean): void {
  if (enabled) {
    startLogForwarding();
  } else {
    stopLogForwarding();
  }
  saveDiagnosticsPrefs({ ...loadDiagnosticsPrefs(), forwardLogs: enabled });
}
