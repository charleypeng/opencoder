// L2 tests for the toast host component (TASK-M6-06): it renders every
// toast from the store with its kind marker, a dismiss button that removes
// the toast, and nothing while the stack is empty.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Toasts } from "./Toast";
import { clearToasts, createToast, toasts } from "../stores/toasts";

describe("Toasts (TASK-M6-06)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
  });

  afterEach(() => {
    clearToasts();
    vi.useRealTimers();
  });

  it("renders nothing while the stack is empty", () => {
    render(() => <Toasts />);
    expect(screen.queryByTestId("toast")).toBeNull();
  });

  it("renders each toast with its message and kind marker", () => {
    createToast("Context compressed", "success");
    createToast("AGENTS.md generated", "success");
    createToast("Boom", "error");
    render(() => <Toasts />);
    expect(screen.getAllByTestId("toast")).toHaveLength(3);
    const first = screen.getAllByTestId("toast")[0];
    expect(first.textContent).toContain("Context compressed");
    expect(first).toHaveAttribute("data-kind", "success");
    expect(screen.getByText("Boom").closest("[data-kind]")).toHaveAttribute("data-kind", "error");
  });

  it("dismisses a toast through its close button", () => {
    const created = createToast("Context compressed", "success");
    render(() => <Toasts />);
    fireEvent.click(screen.getByLabelText(/dismiss/i));
    expect(toasts.some((toast) => toast.id === created.id)).toBe(false);
  });
});
