// Frontend log capture (TASK-M9-07): a bounded ring buffer (200 entries)
// of frontend errors and warnings for the diagnostics center. Capture is
// installed by DesktopShell at mount (window.onerror + console.error/warn
// hooks), so logs are collected app-wide — including before the settings
// view is ever opened — and the log-forwarding engine can replay them to
// the server. Subscribers are notified on every append so the console UI
// stays live without polling.

export type CapturedLevel = "error" | "warn";

export interface CapturedLogEntry {
  /** Monotonic id (newest last in the ring). */
  id: number;
  level: CapturedLevel;
  message: string;
  /** Epoch milliseconds of the capture. */
  time: number;
}

const RING_CAPACITY = 200;
const PREFIXES = ["[stores]", "[diagnostics]"];

export const logCapture = {
  /** Ring buffer, newest entry last. */
  entries: [] as CapturedLogEntry[],
  subscribers: new Set<(entry: CapturedLogEntry) => void>(),
  nextId: 1,
  /** The original console methods the capture wraps (restored on uninstall). */
  original: {
    error: console.error,
    warn: console.warn,
  },
};

let installed = false;
let lastWindowOnError: OnErrorEventHandler | null = null;

/** Appends an entry to the ring (newest last, bounded to 200). */
export function appendLogEntry(level: CapturedLevel, message: string, time = Date.now()): void {
  const entry: CapturedLogEntry = { id: logCapture.nextId++, level, message, time };
  logCapture.entries.push(entry);
  if (logCapture.entries.length > RING_CAPACITY) {
    logCapture.entries.splice(0, logCapture.entries.length - RING_CAPACITY);
  }
  for (const subscriber of logCapture.subscribers) subscriber(entry);
}

/** Subscribes to new entries; returns an unsubscribe function. */
export function subscribeToLogEntries(subscriber: (entry: CapturedLogEntry) => void): () => void {
  logCapture.subscribers.add(subscriber);
  return () => logCapture.subscribers.delete(subscriber);
}

/** Drops every captured entry (console stays clear until new events). */
export function clearLogEntries(): void {
  logCapture.entries.length = 0;
}

/**
 * Installs the window.onerror + console.error/warn hooks (idempotent;
 * returns the uninstall function). Debug-prefixed entries ([stores],
 * [diagnostics]) are skipped — they are internal bookkeeping, not user
 * errors, and they would otherwise echo back through the very hooks that
 * report them.
 */
export function installLogCapture(): () => void {
  if (installed) return uninstallLogCapture;
  installed = true;
  lastWindowOnError = window.onerror;
  window.onerror = (message, _source, _lineno, _colno, error) => {
    const text = typeof message === "string" ? message : "Uncaught error";
    appendLogEntry("error", error instanceof Error && error.message !== "" ? error.message : text);
    return false;
  };
  const wrap = (level: CapturedLevel) => {
    const original = logCapture.original[level];
    return (...args: unknown[]) => {
      const message = args
        .map((arg) => (arg instanceof Error ? arg.message : typeof arg === "string" ? arg : ""))
        .filter((text) => text !== "" && !PREFIXES.some((prefix) => text.startsWith(prefix)))
        .join(" ");
      if (message !== "") appendLogEntry(level, message);
      original(...args);
    };
  };
  console.error = wrap("error") as typeof console.error;
  console.warn = wrap("warn") as typeof console.warn;
  return uninstallLogCapture;
}

/** Restores the original hooks (idempotent; safe without an install). */
export function uninstallLogCapture(): void {
  if (!installed) return;
  window.onerror = lastWindowOnError;
  lastWindowOnError = null;
  console.error = logCapture.original.error;
  console.warn = logCapture.original.warn;
  installed = false;
}
