// Pet companion window shell (TASK-M8-07/08): the frontend page of the
// pet window (label "pet", route /pet — App redirects the whole shell
// here). A transparent frameless always-on-top window renders the pet —
// a CSS blob with eyes — animated per state (ui-design §6): idle bobs,
// working types at a speed driven by the forwarded intensity (0-100),
// waiting raises a waving paw, success bounces, error droops, attention
// sparks (forwarded, e.g. a pending question) or shows a heart (local
// headpat). The window is a Tauri drag region (`data-tauri-drag-
// region="deep"`), so the blob drags the window and the form controls
// (the drag script excludes interactive elements) keep working.
//
// TASK-M8-08 interaction model: a single click is a HEADPAT (bounce +
// heart) — local to the pet window: the state pill shows "Attention" for
// TRANSIENT_MS.attention and reverts to the last forwarded state; a
// forwarded state (e.g. the session turning busy) always supersedes it,
// so no cross-window interaction channel is needed. A double click
// collapses the window to COLLAPSED_SIZE (a tiny blob with a restore
// hint) and double-clicking again restores the stored size. Interactions
// are deliberately NOT forwarded through pet_set_state: the main window's
// watcher owns the forwarded state, and a self-echo would clobber the
// revert anchor.
//
// The mute pref (petPrefs / pet_set_mute) is consumed here as a no-op:
// the CSS pet is silent by construction, and a future sound/Rive renderer
// would gate on it (documented in petPrefs.ts).
//
// The gear button / right-click opens the settings popover: size slider
// (120-200), opacity slider (0.4-1.0 — applied as CSS opacity, Tauri 2
// has no runtime window opacity, see docs/tasks/M8.md), topmost / mute /
// edge-dock / click-through toggles and a Hide button. Every change is
// applied to Rust immediately and persisted in the pet window's own
// localStorage (`oc-pet`), re-applied on the next mount via
// applyPetPrefs. Click-through is a lockout risk by design (the window
// ignores every pointer event) — the popover copy points at the escape
// hatches: the main window's Desktop settings "Pet click-through" switch
// and the auto-revert that re-enables clicks every time the window is
// shown again (Rust-side in pet_show). Linux without a compositor loses
// the transparency and shows the opaque rounded blob (documented
// fallback, docs/tasks/M8.md).

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import {
  hidePet,
  setPetDock,
  setPetIgnoreMouse,
  setPetMute,
  setPetOpacity,
  setPetSize,
  setPetTopmost,
  subscribeToPetIntensity,
  subscribeToPetState,
  type PetAnimationState,
} from "../../services/pet.js";
import { applyPetPrefs, loadPetPrefs, savePetPrefs } from "./petPrefs.js";
import { TRANSIENT_MS } from "./petState.js";

const STATE_LABELS: Record<PetAnimationState, string> = {
  idle: "Idle",
  working: "Working",
  waiting: "Waiting",
  success: "Success",
  error: "Error",
  attention: "Attention",
};

/** Collapsed window edge length (double-click toggle, TASK-M8-08). */
const COLLAPSED_SIZE = 48;

/** Single-click delay: lets a double-click cancel the headpat. */
const CLICK_DELAY_MS = 220;

/** Working animation cycle at intensity 0 (slowest). */
const WORK_DURATION_MAX_MS = 950;

/** Working animation duration (ms) for the current intensity (0-100):
 *  950ms at 0, 400ms at 100. */
function workDuration(intensity: number): number {
  return WORK_DURATION_MAX_MS - Math.round(intensity * 5.5);
}

const PetShell: Component = () => {
  const stored = loadPetPrefs();
  const [state, setState] = createSignal<PetAnimationState>("idle");
  const [lastForwarded, setLastForwarded] = createSignal<PetAnimationState>("idle");
  const [intensity, setIntensity] = createSignal(0);
  const [collapsed, setCollapsed] = createSignal(false);
  const [headpatActive, setHeadpatActive] = createSignal(false);
  const [size, setSize] = createSignal(stored.size ?? 160);
  const [opacity, setOpacity] = createSignal(stored.opacity ?? 1);
  const [topmost, setTopmost] = createSignal(stored.topmost ?? true);
  const [mute, setMute] = createSignal(stored.mute ?? false);
  const [dock, setDock] = createSignal(stored.dock ?? true);
  const [clickThrough, setClickThrough] = createSignal(stored.clickThrough ?? false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  let headpatTimer: ReturnType<typeof setTimeout> | undefined;

  function clearClickTimer() {
    if (clickTimer !== undefined) {
      clearTimeout(clickTimer);
      clickTimer = undefined;
    }
  }

  function clearHeadpat() {
    if (headpatTimer !== undefined) {
      clearTimeout(headpatTimer);
      headpatTimer = undefined;
    }
    setHeadpatActive(false);
  }

  onMount(() => {
    // Re-apply the persisted settings to Rust (size/opacity/topmost/mute/
    // dock/click-through) so a fresh window matches the stored prefs; a
    // rejected IPC is swallowed — the defaults remain in effect.
    void applyPetPrefs().catch(() => {
      // Nothing to report: the window defaults still apply.
    });
    const stopState = subscribeToPetState((next) => {
      setLastForwarded(next);
      setState(next);
      // A forwarded state supersedes a local headpat.
      if (next !== "attention" && headpatTimer !== undefined) clearHeadpat();
    });
    const stopIntensity = subscribeToPetIntensity(setIntensity);
    onCleanup(() => {
      stopState();
      stopIntensity();
      clearClickTimer();
      clearHeadpat();
    });
  });

  function persist(patch: Partial<ReturnType<typeof loadPetPrefs>>) {
    savePetPrefs({ ...loadPetPrefs(), ...patch });
  }

  function changeSize(value: number) {
    setSize(value);
    void setPetSize(value);
    persist({ size: value });
  }

  function changeOpacity(value: number) {
    setOpacity(value);
    void setPetOpacity(value);
    persist({ opacity: value });
  }

  function toggleTopmost() {
    const next = !topmost();
    setTopmost(next);
    void setPetTopmost(next);
    persist({ topmost: next });
  }

  function toggleMute() {
    // The mute pref gates pet SOUNDS; the CSS pet is silent, so the
    // toggle is stored and applied (pet_set_mute) as a no-op for now —
    // a future sound renderer reads the same flag.
    const next = !mute();
    setMute(next);
    void setPetMute(next);
    persist({ mute: next });
  }

  function toggleDock() {
    const next = !dock();
    setDock(next);
    void setPetDock(next);
    persist({ dock: next });
  }

  function toggleClickThrough() {
    const next = !clickThrough();
    setClickThrough(next);
    void setPetIgnoreMouse(next);
    persist({ clickThrough: next });
  }

  /** Headpat easter egg: bounce + heart for the attention lifetime. */
  function headpat() {
    if (collapsed()) return;
    clickTimer = undefined;
    setHeadpatActive(true);
    setState("attention");
    if (headpatTimer !== undefined) clearTimeout(headpatTimer);
    headpatTimer = setTimeout(() => {
      headpatTimer = undefined;
      setHeadpatActive(false);
      setState(lastForwarded());
    }, TRANSIENT_MS.attention);
  }

  function handleBlobClick() {
    if (collapsed()) return;
    clearClickTimer();
    // A single click is a headpat, but a double-click's first click must
    // not trigger it: wait out the double-click window.
    clickTimer = setTimeout(headpat, CLICK_DELAY_MS);
  }

  function handleBlobDoubleClick() {
    clearClickTimer();
    clearHeadpat();
    // The cancelled headpat must not stick on attention: revert to the
    // last forwarded state (the headpat timer that would have reverted it
    // is gone).
    setState(lastForwarded());
    setSettingsOpen(false);
    const next = !collapsed();
    setCollapsed(next);
    void setPetSize(next ? COLLAPSED_SIZE : size());
  }

  const blobSize = () => (collapsed() ? 30 : Math.round(size() * 0.62));

  return (
    <div
      data-testid="pet-shell"
      data-pet-state={state()}
      data-tauri-drag-region="deep"
      style={{ opacity: opacity() }}
      class="flex h-full w-full select-none items-center justify-center bg-transparent"
      onContextMenu={(event) => {
        event.preventDefault();
        if (!collapsed()) setSettingsOpen(true);
      }}
    >
      <div class="relative">
        {/* The pet: a CSS blob with eyes animated per state (the Rive
          renderer is a documented integration point, see petState.ts's
          PetRenderer — no .riv asset exists, so the CSS pet ships). */}
        <div
          data-testid="pet-blob"
          data-pet-state={state()}
          data-headpat={headpatActive() ? "true" : "false"}
          data-collapsed={collapsed() ? "true" : "false"}
          class="pet-blob relative flex items-center justify-center gap-[12%] rounded-full bg-gradient-to-br from-accent-soft to-bg-elevated shadow-lg ring-1 ring-white/10"
          style={{
            width: `${blobSize()}px`,
            height: `${blobSize()}px`,
            // Kebab-case: Solid applies style keys via setProperty, which
            // is case-sensitive for CSS property names.
            "animation-duration":
              state() === "working" ? `${workDuration(intensity())}ms` : undefined,
          }}
          onClick={handleBlobClick}
          onDblClick={handleBlobDoubleClick}
          title={collapsed() ? "Double-click to restore" : "Click to pet"}
        >
          <span class="pet-eye h-[14%] w-[14%] rounded-full bg-fg-primary/90" />
          <span class="pet-eye h-[14%] w-[14%] rounded-full bg-fg-primary/90" />
          {/* Raised, waving paw while waiting for permission. */}
          <span class="pet-paw" aria-hidden="true" />
          {/* Attention sparkle (forwarded attention, e.g. a question). */}
          <span class="pet-sparkle" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor" class="h-3 w-3">
              <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
            </svg>
          </span>
          {/* Headpat heart (local click easter egg). */}
          <span class="pet-heart" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5">
              <path d="M12 21s-7.5-4.7-10-9.2C.6 8.7 2.4 5 5.9 5c2 0 3.4 1.1 4.1 2.4h4C14.7 6.1 16.1 5 18.1 5c3.5 0 5.3 3.7 3.9 6.8C19.5 16.3 12 21 12 21z" />
            </svg>
          </span>
          <Show when={collapsed()}>
            <span
              data-testid="pet-restore-hint"
              class="absolute inset-0 flex items-center justify-center text-[10px] text-fg-secondary"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-3.5 w-3.5"
              >
                <path d="M3 15V9a2 2 0 0 1 2-2h4" />
                <path d="M3 15l4-4" />
                <path d="M21 9v6a2 2 0 0 1-2 2h-4" />
                <path d="M21 9l-4 4" />
              </svg>
            </span>
          </Show>
        </div>
        <Show when={clickThrough() && !collapsed()}>
          <div
            data-testid="pet-click-through"
            class="absolute -top-1 right-1 rounded-full border border-bg-sunken bg-bg-elevated px-1.5 text-[9px] text-fg-secondary"
          >
            passthrough
          </div>
        </Show>
        <Show when={!collapsed()}>
          <div
            data-testid="pet-state"
            class="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full border border-bg-sunken bg-bg-elevated/90 px-2 py-0.5 text-[10px] text-fg-secondary"
          >
            {STATE_LABELS[state()]}
          </div>
          <button
            type="button"
            data-testid="pet-settings-toggle"
            aria-label="Pet settings"
            aria-expanded={settingsOpen() ? "true" : "false"}
            class="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-bg-sunken bg-bg-elevated text-fg-secondary outline-none transition-colors hover:text-fg-primary"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-3 w-3"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </Show>

        <Show when={settingsOpen() && !collapsed()}>
          <div
            data-testid="pet-settings"
            class="absolute bottom-6 right-0 z-10 w-44 rounded-lg border border-bg-sunken bg-bg-elevated p-3 shadow-xl"
          >
            <p class="text-[10px] font-medium text-fg-secondary">Size</p>
            <input
              data-testid="pet-size-slider"
              type="range"
              min={120}
              max={200}
              step={10}
              value={size()}
              aria-label="Pet size"
              onInput={(event) => changeSize(Number(event.currentTarget.value))}
              class="w-full"
            />
            <p class="text-[10px] font-medium text-fg-secondary">Opacity</p>
            <input
              data-testid="pet-opacity-slider"
              type="range"
              min={0.4}
              max={1}
              step={0.05}
              value={opacity()}
              aria-label="Pet opacity"
              onInput={(event) => changeOpacity(Number(event.currentTarget.value))}
              class="w-full"
            />
            <div class="mt-2 space-y-1.5">
              <label class="flex items-center justify-between gap-2 text-[11px]">
                Always on top
                <input
                  data-testid="pet-topmost-toggle"
                  type="checkbox"
                  checked={topmost()}
                  aria-label="Always on top"
                  onChange={toggleTopmost}
                />
              </label>
              <label class="flex items-center justify-between gap-2 text-[11px]">
                Mute sounds
                <input
                  data-testid="pet-mute-toggle"
                  type="checkbox"
                  checked={mute()}
                  aria-label="Mute sounds"
                  onChange={toggleMute}
                />
              </label>
              <label class="flex items-center justify-between gap-2 text-[11px]">
                Edge dock
                <input
                  data-testid="pet-dock-toggle"
                  type="checkbox"
                  checked={dock()}
                  aria-label="Edge dock"
                  onChange={toggleDock}
                />
              </label>
              <label class="flex items-center justify-between gap-2 text-[11px]">
                Click-through
                <input
                  data-testid="pet-click-through-toggle"
                  type="checkbox"
                  checked={clickThrough()}
                  aria-label="Click-through"
                  onChange={toggleClickThrough}
                />
              </label>
              <p class="text-[10px] leading-tight text-fg-faint">
                On: clicks pass through the pet. Re-enable from Desktop settings or by re-showing
                the pet.
              </p>
            </div>
            <button
              type="button"
              data-testid="pet-hide"
              class="mt-2 w-full rounded-md border border-bg-sunken bg-bg-sunken px-2 py-1 text-[11px] text-fg-secondary outline-none hover:text-fg-primary"
              onClick={() => void hidePet()}
            >
              Hide pet
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default PetShell;
