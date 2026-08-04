// L1 tests for the toast store (TASK-M6-06): createToast appends an entry
// with an id/kind, auto-dismisses it after the 3s timeout, dismissToast
// removes it manually, and clearToasts empties the stack (test teardown).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearToasts, createToast, dismissToast, toasts } from "./toasts";

describe("toast store (TASK-M6-06)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
  });

  afterEach(() => {
    clearToasts();
    vi.useRealTimers();
  });

  it("createToast appends a toast with an id, kind and message", () => {
    createToast("Context compressed", "success");
    createToast("AGENTS.md generated", "success");
    expect(toasts).toHaveLength(2);
    expect(toasts[0]).toMatchObject({ kind: "success", message: "Context compressed" });
    expect(typeof toasts[0].id).toBe("string");
    expect(toasts[1]).toMatchObject({ kind: "success", message: "AGENTS.md generated" });
  });

  it("defaults the kind to info", () => {
    createToast("Something happened");
    expect(toasts[0].kind).toBe("info");
  });

  it("auto-dismisses a toast after 3 seconds", () => {
    createToast("Context compressed", "success");
    expect(toasts).toHaveLength(1);
    vi.advanceTimersByTime(2999);
    expect(toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts).toHaveLength(0);
  });

  it("dismissToast removes only the matching toast", () => {
    const first = createToast("one", "info");
    const second = createToast("two", "error");
    dismissToast(first.id);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].id).toBe(second.id);
  });

  it("clearToasts empties the stack", () => {
    createToast("one", "info");
    createToast("two", "error");
    clearToasts();
    expect(toasts).toHaveLength(0);
  });
});
