// Token rate store (TASK-M8-08): the pet's working intensity follows the
// token rate — every `message.part.delta` routed through stores/events.ts
// bumps the counter (bumpTokenRate), and the rate is the number of deltas
// inside the last 1s sliding window. A decay interval drops the rate back
// to zero on its own after a burst, so the working animation slows and
// stops even if no further delta events arrive. The watcher maps the rate
// to the 0-100 intensity (workingIntensity) and forwards it to the pet
// window through pet_set_intensity / the `pet-intensity` event.

import { createStore } from "solid-js/store";

/** Sliding window length in ms. */
export const TOKEN_WINDOW_MS = 1000;
/** How often the window is pruned (auto-decay of a finished burst). */
const DECAY_INTERVAL_MS = 250;

const [tokenRateStore, setTokenRate] = createStore<{ rate: number }>({ rate: 0 });

/** Reactive per-second delta rate (read-only outside this module). */
export { tokenRateStore };

const timestamps: number[] = [];

function prune(now: number): void {
  while (timestamps.length > 0 && now - timestamps[0] >= TOKEN_WINDOW_MS) {
    timestamps.shift();
  }
}

function publish(): void {
  setTokenRate({ rate: timestamps.length });
}

// Sliding-window decay: with no further deltas the rate falls back to
// zero within one window, so the intensity fades with the stream. The
// interval is created lazily on the FIRST bump (so it lives in whatever
// timer context observed the delta) and keeps pruning while the process
// runs; it no-ops when the window is empty.
let decayTimer: ReturnType<typeof setInterval> | undefined;
function startDecay(): void {
  if (decayTimer !== undefined) return;
  decayTimer = setInterval(() => {
    if (timestamps.length === 0) return;
    const now = Date.now();
    prune(now);
    publish();
  }, DECAY_INTERVAL_MS);
}

/** Records one streamed delta (called from the events router). */
export function bumpTokenRate(): void {
  const now = Date.now();
  prune(now);
  timestamps.push(now);
  startDecay();
  publish();
}

/** Clears the rate and stops the decay timer (test teardown — a new
 *  bump re-creates the timer in the current timer context). */
export function resetTokenRate(): void {
  timestamps.length = 0;
  if (decayTimer !== undefined) {
    clearInterval(decayTimer);
    decayTimer = undefined;
  }
  publish();
}

/** Maps a delta rate (deltas/second) to the 0-100 working intensity;
 *  25 deltas/s saturates the typing speed. */
export function workingIntensity(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(100, Math.round(rate * 4));
}
