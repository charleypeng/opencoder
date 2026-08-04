// Streaming activity indicator (TASK-M2-09): derives "this session is
// generating right now" from two store facts — the session status (busy /
// retry from the session store) and the messages store's `lastDeltaAt`
// (bumped by every part update/delta). A session counts as streaming while
// it is busy AND a part mutation landed within the last 5 seconds; the
// 5-second window keeps the typing cursor and any derived affordances alive
// across SSE batches (the Rust side pushes events in ~16ms batches, so a
// token can legitimately take a moment to arrive).
//
// The server/session ids are passed as ACCESSORS so the memos re-track on
// session switches; a hook must never capture props once at component scope.
//
// A 1s interval re-reads the clock only while a delta timestamp exists and
// the session is streaming; it is stopped as soon as neither is true and
// cleared on unmount.

import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { getServerSessionState } from "../../stores/session.js";
import { messages } from "../../stores/messages.js";

/** How long a session stays "streaming" after its last part mutation. */
export const STREAMING_WINDOW_MS = 5000;
const TICK_MS = 1000;

export function useStreamingIndicator(
  serverId: () => string,
  sessionId: () => string,
): {
  /** True while the session is generating and deltas are recent. */
  streaming: () => boolean;
  /** True while the session status is busy/retry (generation in flight). */
  busy: () => boolean;
} {
  const lastDeltaAt = createMemo(() => messages[serverId()]?.[sessionId()]?.lastDeltaAt);
  const status = createMemo(() => getServerSessionState(serverId()).statuses[sessionId()]);
  const busy = createMemo(() => status()?.type === "busy" || status()?.type === "retry");
  const [now, setNow] = createSignal(Date.now());

  const streaming = createMemo(() => {
    if (!busy()) return false;
    const stamp = lastDeltaAt();
    return stamp !== undefined && now() - stamp < STREAMING_WINDOW_MS;
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  createEffect(() => {
    const stamp = lastDeltaAt();
    if (stamp === undefined) return;
    // Fresh clock on every new delta; the interval only exists while the
    // window is open, so the timer stays idle for quiet sessions.
    setNow(Date.now());
    if (streaming()) {
      if (timer === undefined) timer = setInterval(() => setNow(Date.now()), TICK_MS);
    } else if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  });
  onCleanup(() => {
    if (timer !== undefined) clearInterval(timer);
  });

  return { streaming, busy };
}
