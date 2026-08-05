// Pet event wiring (TASK-M8-08): translates store state changes into the
// pet's animation state (petEvents) and working intensity (tokenRate).
// startPetWatcher(serverId) folds the FULL fact set of the active server
// (aggregate session status + permission/question queues) through the pure
// reducer on every store change and forwards the resulting state to the
// pet window ONCE per fold — no intermediate states ever reach the pet,
// so release sequences (e.g. a permission drain while still generating)
// resolve to their final state without flicker. Success/attention are
// transient: the watcher schedules their revert timer and clears it as
// soon as the state leaves the transient. The mount snapshot IS applied
// (a pet reflects the current truth — unlike the haptics/notifications
// watchers, whose first observation must not be an event). Interactions
// (headpat, collapse) are pet-window-local (see PetShell) — the main
// window has no channel into the pet's pointer events; the next forwarded
// state naturally supersedes a local attention.
// DesktopShell mounts the watcher for the ACTIVE server (like the
// notifications watcher), so the pet follows the server in focus.

import { createEffect, createRoot, onCleanup } from "solid-js";
import { getServerSessionState } from "../../stores/session.js";
import { permissions } from "../../stores/permission.js";
import { questions } from "../../stores/question.js";
import { setPetIntensity, setPetState } from "../../services/pet.js";
import {
  reducePetState,
  toAnimationState,
  TRANSIENT_MS,
  type PetEvent,
  type PetState,
} from "./petState.js";
import { tokenRateStore, workingIntensity } from "./tokenRate.js";

/**
 * Watches the given server's session statuses, permission queue, question
 * queue and token rate, and forwards the resulting pet state / intensity
 * to the pet window. Returns a dispose function. Each effect run re-derives
 * the FULL fact set and folds it through reducePetState starting from the
 * previously displayed state, then invokes pet_set_state at most once (the
 * reducer is idempotent over repeated fact re-assertions, so re-folding on
 * unrelated changes is a no-op); the intensity effect fires only on
 * changes, so a steady token rate does not spam the IPC channel.
 */
export function startPetWatcher(serverId: string): () => void {
  return createRoot((dispose) => {
    let current: PetState = "idle";
    let lastSent: PetState | null = null;
    let lastIntensity = -1;
    let disposed = false;
    let transientTimer: ReturnType<typeof setTimeout> | undefined;

    function push(events: PetEvent[]): void {
      // A root-disposed effect may still flush once (Solid's scheduler);
      // a disposed watcher must not forward states for a stale server.
      if (disposed) return;
      for (const event of events) {
        current = reducePetState(current, event, { tokenRate: tokenRateStore.rate });
      }
      if (transientTimer !== undefined) {
        clearTimeout(transientTimer);
        transientTimer = undefined;
      }
      if (current === "success" || current === "attention") {
        transientTimer = setTimeout(() => {
          transientTimer = undefined;
          // Re-assert the FULL fact set AFTER the transient releases: a
          // fact that was blocked while the transient displayed (e.g. a
          // question that arrived during success) must render once the
          // transient is gone instead of being dumped to idle.
          push([{ type: "transient.expired" }, ...currentEvents()]);
        }, TRANSIENT_MS[current]);
      }
      if (current !== lastSent) {
        lastSent = current;
        // Best-effort IPC (the pet window may not exist yet when the pet
        // pref is off): a rejected invoke never surfaces as an unhandled
        // rejection.
        void setPetState(toAnimationState(current)).catch(() => {});
      }
    }

    /** The FULL fact set (aggregate session status + permission/question
     *  queues) as fold events, re-read from the live stores. */
    function currentEvents(): PetEvent[] {
      const { statuses } = getServerSessionState(serverId);
      const permissionQueue = permissions[serverId]?.queue ?? [];
      const questionQueue = questions[serverId]?.queue ?? [];
      const entries = Object.values(statuses);
      const anyError = entries.some((entry) => entry.type === "error");
      const anyGenerating = entries.some(
        (entry) => entry.type === "busy" || entry.type === "retry",
      );
      // Fold order: the permission fact first, the session fact, the
      // question fact LAST — a drain (permission.replied) releases the
      // wait and the session re-assertion then lands the pet on the right
      // base state; a question blocked by a higher-ranked fact (error,
      // success) is re-asserted after that fact releases within the same
      // fold, so it renders once the release happens.
      const events: PetEvent[] = [];
      events.push(
        permissionQueue.length > 0 ? { type: "permission.asked" } : { type: "permission.replied" },
      );
      events.push({
        type: "session.status",
        status: anyError ? "error" : anyGenerating ? "busy" : "idle",
      });
      if (questionQueue.length > 0) events.push({ type: "question.asked" });
      return events;
    }

    createEffect(() => {
      push(currentEvents());
    });

    createEffect(() => {
      const intensity = workingIntensity(tokenRateStore.rate);
      if (intensity === lastIntensity) return;
      lastIntensity = intensity;
      // Best-effort IPC, like the state forwarding above.
      void setPetIntensity(intensity).catch(() => {});
    });

    onCleanup(() => {
      disposed = true;
      if (transientTimer !== undefined) clearTimeout(transientTimer);
    });

    return dispose;
  });
}
