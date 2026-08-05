// L1 tests for the frontend log capture (TASK-M9-07): the bounded ring
// buffer, subscriber notifications, the window.onerror + console hooks
// installed by DesktopShell, the debug-prefix filter and the uninstall
// restore.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendLogEntry,
  clearLogEntries,
  installLogCapture,
  logCapture,
  subscribeToLogEntries,
  uninstallLogCapture,
} from "./logCapture.js";

const realError = console.error;
const realWarn = console.warn;

afterEach(() => {
  uninstallLogCapture();
  console.error = realError;
  console.warn = realWarn;
  clearLogEntries();
  logCapture.nextId = 1;
});

describe("ring buffer", () => {
  it("appends entries newest last and notifies subscribers", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeToLogEntries((entry) => seen.push(entry.message));
    appendLogEntry("error", "first", 1000);
    appendLogEntry("warn", "second", 2000);
    unsubscribe();
    appendLogEntry("error", "third", 3000);

    expect(logCapture.entries.map((entry) => entry.message)).toEqual(["first", "second", "third"]);
    expect(logCapture.entries[0]).toMatchObject({ level: "error", time: 1000 });
    expect(seen).toEqual(["first", "second"]);
  });

  it("bounds the ring to 200 entries, dropping the oldest", () => {
    for (let i = 0; i < 250; i += 1) appendLogEntry("warn", `entry ${i}`);
    expect(logCapture.entries.length).toBe(200);
    expect(logCapture.entries[0].message).toBe("entry 50");
    expect(logCapture.entries[199].message).toBe("entry 249");
  });

  it("clearLogEntries empties the ring", () => {
    appendLogEntry("error", "x");
    clearLogEntries();
    expect(logCapture.entries.length).toBe(0);
  });
});

describe("installLogCapture", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("captures console.error and console.warn calls with their messages", () => {
    const stop = installLogCapture();
    console.error("boom", new Error("detail"));
    console.warn("careful", "now");
    expect(logCapture.entries.map((entry) => entry.level)).toEqual(["error", "warn"]);
    expect(logCapture.entries[0].message).toBe("boom detail");
    expect(logCapture.entries[1].message).toBe("careful now");
    stop();
    expect(console.error).toBe(realError);
  });

  it("skips debug-prefixed bookkeeping entries", () => {
    installLogCapture();
    console.warn("[stores] ignoring unknown event");
    console.error("[diagnostics] internal");
    expect(logCapture.entries.length).toBe(0);
  });

  it("captures window.onerror with the error message", () => {
    const stop = installLogCapture();
    window.onerror?.("Uncaught TypeError: x is not a function", "app.js", 1, 1, undefined);
    expect(logCapture.entries.length).toBe(1);
    expect(logCapture.entries[0]).toMatchObject({
      level: "error",
      message: "Uncaught TypeError: x is not a function",
    });
    stop();
    expect(window.onerror).toBeNull();
  });

  it("is idempotent and restores the original hooks on uninstall", () => {
    const stop = installLogCapture();
    const second = installLogCapture();
    console.error("only once");
    expect(logCapture.entries.length).toBe(1);
    expect(second).toBe(stop);
    stop();
    expect(console.error).toBe(realError);
  });
});
