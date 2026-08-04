// Toast store (TASK-M6-06): the minimal result-feedback toasts used by the
// session summarize/init flows. createToast appends an entry and schedules
// its auto-dismissal after 3s; dismissToast removes an entry early and
// clearToasts empties the stack (used by tests and on shell unmount).

import { createStore } from "solid-js/store";

export type ToastKind = "info" | "success" | "error";

export interface ToastEntry {
  id: string;
  kind: ToastKind;
  message: string;
}

const AUTO_DISMISS_MS = 3000;

const [toastList, setToastList] = createStore<ToastEntry[]>([]);

/** Reactive toast stack (newest last). */
export { toastList as toasts };

/** Appends a toast and auto-dismisses it after 3 seconds. */
export function createToast(message: string, kind: ToastKind = "info"): ToastEntry {
  const entry: ToastEntry = {
    id: `toast_${Math.random().toString(36).slice(2, 10)}`,
    kind,
    message,
  };
  setToastList((list) => [...list, entry]);
  window.setTimeout(() => dismissToast(entry.id), AUTO_DISMISS_MS);
  return entry;
}

/** Removes the toast with the given id, if still present. */
export function dismissToast(id: string): void {
  setToastList((list) => list.filter((toast) => toast.id !== id));
}

/** Removes all toasts (test teardown / shell unmount). */
export function clearToasts(): void {
  setToastList([]);
}
