// System notification facade (TASK-M8-06): thin typed wrapper over the
// tauri-plugin-notification 2.3.3 guest API. Desktop permission is a
// no-op (the plugin grants unconditionally; macOS shows via the
// deprecated NSUserNotificationCenter which needs no authorization), so
// `notify` only prompts on mobile (iOS/Android runtime permission) and
// then only on first use. Mirrors the events.ts outside-Tauri no-op
// guard so the surface never touches the IPC layer in web builds.
// NOTE: the plugin has no click API on desktop — `onAction` (the
// `actionPerformed` event) is emitted only by the iOS/Android natives;
// notify-rust's `show()` registers no click callback. The click
// subscription below is therefore a mobile-only channel (and the
// desktop limitation is documented in docs/tasks/M8.md); `tag` is
// accepted for API parity but unused — NotificationData has no tag
// field in 2.3.3.

import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface NotifyOptions {
  /** Notification title. */
  title: string;
  /** Optional notification body. */
  body?: string;
  /** Accepted for API parity; unused — the plugin has no tag support. */
  tag?: string;
}

function inTauri(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

/** Cached permission resolution: the OS prompt is requested at most once
 *  per run (desktop resolves granted without a prompt; a denied mobile
 *  grant stays denied until the user re-enables it in OS settings). */
let permissionPromise: Promise<boolean> | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permissionPromise === null) {
    permissionPromise = (async () => {
      if (await isPermissionGranted()) return true;
      const permission = await requestPermission();
      return permission === "granted";
    })();
  }
  return permissionPromise;
}

/** Sends a system notification; resolves silently outside Tauri or when
 *  permission is denied. Callers apply the prefs + window-focus gate
 *  (notificationEvents.shouldNotify) before calling. */
export async function notify(options: NotifyOptions): Promise<void> {
  if (!inTauri()) return;
  if (!(await ensurePermission())) return;
  sendNotification({ title: options.title, body: options.body });
}

/** Whether the main window currently has keyboard focus. Outside Tauri it
 *  resolves true (a web build has no background to notify). */
export async function isWindowFocused(): Promise<boolean> {
  if (!inTauri()) return true;
  return getCurrentWindow().isFocused();
}

/** Brings the main window to the front (notification click handling). */
export async function focusWindow(): Promise<void> {
  if (!inTauri()) return;
  await getCurrentWindow().setFocus();
}

/** Subscribes to notification clicks (the `actionPerformed` event). The
 *  plugin only emits it on iOS/Android — on desktop the notification is
 *  fire-and-forget (documented limitation); the permission/question
 *  sheets are global, so focusing the window is all a click needs to do.
 *  Returns an unlisten function; a no-op outside Tauri. */
export function subscribeToNotificationClick(onClick: () => void): () => void {
  if (!inTauri()) return () => {};
  const listener = onAction(() => onClick());
  return () => {
    void listener.then((handle) => handle.unregister());
  };
}
