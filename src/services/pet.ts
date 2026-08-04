// Pet companion window facade (TASK-M8-07): thin typed wrappers over the
// Rust pet commands (pet_show / pet_hide / pet_is_visible / pet_set_state
// / pet_set_ignore_mouse / pet_set_size / pet_set_opacity / pet_set_topmost
// / pet_set_mute / pet_set_dock) and the `pet-state` event Rust emits to
// the pet window when the main window's frontend forwards an animation
// state. Mirrors the events.ts outside-Tauri no-op guard so the desktop-
// only surface never touches the IPC layer in web or mobile builds. The
// window itself is created and owned Rust-side (transparent frameless
// always-on-top, label "pet"); these calls are the main window's controls
// (show/hide/forward state) and the pet window's settings application.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Animation states the pet frontend renders (ui-design §6); must stay in
 *  sync with PetAnimationState in src-tauri/src/pet.rs (serialized
 *  lower-case there). */
export type PetAnimationState = "idle" | "working" | "waiting" | "success" | "error" | "attention";

/** The `pet-state` event Rust emits to the pet window. */
export const PET_STATE_EVENT = "pet-state";

function inTauri(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

/** Shows the pet window, creating it on first use (Rust-side, with the
 *  last-applied settings); does not steal focus. No-op outside Tauri. */
export function showPet(): Promise<void> {
  if (!inTauri()) return Promise.resolve();
  return invoke("pet_show");
}

/** Hides the pet window (kept alive for instant re-show). No-op outside
 *  Tauri. */
export function hidePet(): Promise<void> {
  if (!inTauri()) return Promise.resolve();
  return invoke("pet_hide");
}

/** Whether the pet window exists and is visible; false outside Tauri. */
export function isPetVisible(): Promise<boolean> {
  if (!inTauri()) return Promise.resolve(false);
  return invoke("pet_is_visible");
}

/** Forwards an animation state to the pet window (Rust emits `pet-state`
 *  there); the state is remembered and re-emitted on the next show.
 *  No-op outside Tauri. */
export function setPetState(state: PetAnimationState): Promise<void> {
  if (!inTauri()) return Promise.resolve();
  return invoke("pet_set_state", { petState: state });
}

/** Toggles mouse click-through on the pet window (it keeps rendering but
 *  never receives pointer events). No-op outside Tauri. */
export function setPetIgnoreMouse(ignore: boolean): Promise<void> {
  if (!inTauri()) return Promise.resolve();
  return invoke("pet_set_ignore_mouse", { ignore });
}

/** Resizes the pet window (square, clamped to 120-200). No-op outside
 *  Tauri. */
export function setPetSize(size: number): Promise<void> {
  if (!inTauri() || !Number.isInteger(size)) return Promise.resolve();
  return invoke("pet_set_size", { size });
}

/** Stores the pet window opacity pref (clamped to 0.4-1.0; Tauri 2 has no
 *  runtime window opacity, so the pet window applies it as CSS opacity —
 *  see docs/tasks/M8.md). No-op outside Tauri. */
export function setPetOpacity(opacity: number): Promise<void> {
  if (!inTauri() || typeof opacity !== "number") return Promise.resolve();
  return invoke("pet_set_opacity", { opacity });
}

/** Pins the pet window above other windows (or releases it). No-op
 *  outside Tauri. */
export function setPetTopmost(topmost: boolean): Promise<void> {
  if (!inTauri()) return Promise.resolve();
  return invoke("pet_set_topmost", { topmost });
}

/** Stores the pet sound mute flag (consumed by the animation task M8-08;
 *  the pet window also persists it locally). No-op outside Tauri. */
export function setPetMute(muted: boolean): Promise<void> {
  if (!inTauri()) return Promise.resolve();
  return invoke("pet_set_mute", { muted });
}

/** Enables or disables the edge-dock snap (Rust listens for window moves
 *  and snaps within 30px of a screen edge). No-op outside Tauri. */
export function setPetDock(docked: boolean): Promise<void> {
  if (!inTauri()) return Promise.resolve();
  return invoke("pet_set_dock", { docked });
}

/** Subscribes to animation states forwarded by the main window; returns
 *  an unlisten function. Outside Tauri it is a no-op. */
export function subscribeToPetState(onState: (state: PetAnimationState) => void): () => void {
  if (!inTauri()) return () => {};
  const unlisten = listen(PET_STATE_EVENT, (event) => {
    const payload = event.payload as PetAnimationState;
    if (
      payload === "idle" ||
      payload === "working" ||
      payload === "waiting" ||
      payload === "success" ||
      payload === "error" ||
      payload === "attention"
    ) {
      onState(payload);
    }
  });
  return () => {
    void unlisten.then((unlisten) => unlisten());
  };
}
