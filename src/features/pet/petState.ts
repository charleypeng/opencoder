// Pet state machine (TASK-M8-08, ui-design §6): a pure reducer mapping
// coding events (session statuses, permission/question requests,
// interactions) to the six pet animation states. The state machine is the
// deliverable of the animation task; the RENDERER is pluggable — the
// shipped renderer is the CSS pet in PetShell (zero asset weight, far
// under the 500KB budget), and a Rive-backed implementation can plug in
// through the PetRenderer contract once a .riv asset exists, without
// touching this module or the event linkage.
//
// Transition model: the main-window watcher (petEvents.ts) folds the FULL
// fact set (aggregate session status, permission/question queues,
// transient expirations) through reducePetState on every store change and
// forwards the resulting state once. Every fold re-asserts all facts, so
// individual events do not need to be idempotent:
// - session.status re-asserts the SESSION fact (the watcher aggregates the
//   status map, so "busy" arriving while an error is displayed means the
//   error fact is gone — a dismissed error — and displaces it);
// - permission.asked/replied re-assert the PERMISSION fact;
// - question.asked fires the attention transient;
// - transient.expired releases a success/attention transient whose timer
//   the caller ran out.
// The display priority (error > waiting_permission > working > success >
// attention > idle) decides which fact wins when several are active;
// release events (permission.replied, transient.expired, a session idle
// after error or a completed generation) force their target because the
// fold has already re-derived the underlying facts.

import type { PetAnimationState } from "../../services/pet.js";

/** The pet's animation states (ui-design §6; the pet window renders
 *  "waiting_permission" as its "waiting" animation state). */
export type PetState =
  "idle" | "working" | "waiting_permission" | "success" | "error" | "attention";

/** Coding events the reducer maps to pet states. `interaction` covers the
 *  click/feed easter eggs (handled locally by PetShell today). */
export type PetEvent =
  | { type: "session.status"; status: "busy" | "retry" | "idle" | "error" }
  | { type: "permission.asked" }
  | { type: "permission.replied" }
  | { type: "question.asked" }
  | { type: "interaction" }
  | { type: "transient.expired" };

/** Reducer context (kept as the renderer-facing contract for the future
 *  Rive integration; transitions are event-driven only, see below). */
export interface PetReduceContext {
  /** Token deltas per second window (working intensity input). */
  tokenRate: number;
}

/** Transient state lifetimes, handled by the watcher's timers. */
export const TRANSIENT_MS: Readonly<Record<"success" | "attention", number>> = {
  success: 3000,
  attention: 5000,
};

/** Display priority of the states (ui-design §6): when several facts are
 *  active the highest-ranked one renders. */
const PRIORITY: Record<PetState, number> = {
  error: 6,
  waiting_permission: 5,
  working: 4,
  success: 3,
  attention: 2,
  idle: 1,
};

/**
 * Renderer contract the pet frontend satisfies (TASK-M8-08): a Rive-backed
 * implementation can plug in once a .riv state-machine asset exists — it
 * only needs to render one state at a time plus the working intensity
 * (0-100). The shipped renderer is the CSS pet in PetShell; the interface
 * documents the swap point so the state machine and the event linkage stay
 * untouched.
 */
export interface PetRenderer {
  /** Renders the given state (the pet window receives it as `pet-state`). */
  setState(state: PetAnimationState): void;
  /** Drives the working animation speed (0 = idle pace, 100 = max). */
  setIntensity(intensity: number): void;
}

/** The state one event implies from `current`; undefined = no change. */
function targetFor(current: PetState, event: PetEvent): PetState | undefined {
  switch (event.type) {
    case "session.status":
      switch (event.status) {
        case "error":
          return "error";
        case "busy":
        case "retry":
          // The session fact is generating: displaces a stale error (the
          // watcher's aggregate would be "error" while an error is still
          // active), transients and idle — but never an active permission
          // wait (waiting_permission > working).
          return current === "waiting_permission" ? "waiting_permission" : "working";
        case "idle":
          // The session fact relaxed: a dismissed error releases, a
          // completed generation becomes the success transient, and an
          // active transient or permission wait keeps displaying.
          if (current === "error") return "idle";
          if (current === "working") return "success";
          if (current === "success") return "success";
          return current;
      }
      return undefined;
    case "permission.asked":
      return "waiting_permission";
    case "permission.replied":
      // The permission fact drained: release the wait (forced by the
      // caller — the fold re-asserted the other facts alongside).
      return current === "waiting_permission" ? "idle" : undefined;
    case "question.asked":
      return "attention";
    case "interaction":
      return "attention";
    case "transient.expired":
      return current === "success" || current === "attention" ? "idle" : undefined;
  }
}

/**
 * The pure transition function: maps `event` on `current` to the next
 * state. Lower-ranked targets only render when they do not displace a
 * higher-ranked fact; the release events (session.status re-assertions,
 * permission.replied, transient.expired) force their target because
 * targetFor already encodes every release decision — the caller's fold
 * has re-derived the underlying facts, so an e.g. "idle" release must not
 * be swallowed by the still-displayed error.
 */
export function reducePetState(
  current: PetState,
  event: PetEvent,
  ctx: PetReduceContext,
): PetState {
  // ctx.tokenRate is the working-intensity input consumed by the renderer
  // (see PetRenderer); the transition rules are event-driven only, so the
  // context is accepted for the renderer contract and intentionally unused
  // by the transitions themselves.
  void ctx;
  const target = targetFor(current, event);
  if (target === undefined) return current;
  if (
    event.type === "session.status" ||
    event.type === "permission.replied" ||
    event.type === "transient.expired"
  ) {
    return target;
  }
  // permission.asked / question.asked / interaction: the new fact only
  // renders when it outranks the displayed one (error > waiting >
  // working > success > attention > idle).
  return PRIORITY[target] >= PRIORITY[current] ? target : current;
}

/** Maps a PetState to the pet window's animation state union
 *  (waiting_permission renders as the "waiting" animation). */
export function toAnimationState(state: PetState): PetAnimationState {
  if (state === "waiting_permission") return "waiting";
  return state;
}
