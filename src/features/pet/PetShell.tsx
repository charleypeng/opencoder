// Pet companion window shell (TASK-M8-07/08): the frontend page of the
// pet window (label "pet", route /pet — App redirects the whole shell
// here). A transparent frameless always-on-top window renders the pet —
// a transparent, borderless canvas with no status pill or settings control.
// The character is anchored to the lower-left of the canvas so it naturally
// blends into the client background. The entire canvas is a native Tauri drag
// region and also calls startDragging explicitly on primary-button press, so
// the user can move the pet with the mouse. The main Settings → Pet page
// remains the only settings entry point.
//
// TASK-M8-08 interaction model: a single click is a HEADPAT (bounce +
// heart) — local to the pet window: a single click animates the character
// for TRANSIENT_MS.attention and then reverts to the last forwarded state; a
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
// Pet display settings (character, movement, size, opacity) live in the
// main Settings → Pet page. The pet window itself intentionally has no
// visible controls; click-through remains a main-window escape-hatch
// setting and Rust re-enables pointer events whenever the pet is shown.
// Linux without a compositor can still lose transparency and show an opaque
// window; the browser body is explicitly cleared to transparent on mount.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { setPetSize } from "../../services/pet.js";
import {
  subscribeToPetIntensity,
  subscribeToPetPrefs,
  type PetPrefsPayload,
  subscribeToPetState,
  type PetAnimationState,
  notifyPetPrefsChanged,
} from "../../services/pet.js";
import { applyPetPrefs, loadPetPrefs, savePetPrefs, type PetMovement } from "./petPrefs.js";
import { refreshPetPacks, resolvedPetPackId } from "./packStore.js";
import PetSurface from "./PetSurface.js";
import { TRANSIENT_MS } from "./petState.js";
import type { PetReaction } from "./renderers/types.js";
import { useT } from "../../i18n/index.js";

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
  const t = useT();
  const stored = loadPetPrefs();
  const [state, setState] = createSignal<PetAnimationState>("idle");
  const [lastForwarded, setLastForwarded] = createSignal<PetAnimationState>("idle");
  const [intensity, setIntensity] = createSignal(0);
  const [collapsed, setCollapsed] = createSignal(false);
  const [headpatActive, setHeadpatActive] = createSignal(false);
  const [reaction, setReaction] = createSignal<PetReaction | null>(null);
  const [size, setSize] = createSignal(stored.size ?? 160);
  const [opacity, setOpacity] = createSignal(stored.opacity ?? 1);
  const [selectedPackId, setSelectedPackId] = createSignal(stored.selectedPackId);
  const [movement, setMovement] = createSignal<PetMovement>(stored.movement ?? "fixed");
  let movementTimer: ReturnType<typeof setInterval> | undefined;

  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  let headpatTimer: ReturnType<typeof setTimeout> | undefined;
  let reactionTimer: ReturnType<typeof setTimeout> | undefined;

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
    clearReaction();
  }

  function clearReaction() {
    if (reactionTimer !== undefined) {
      clearTimeout(reactionTimer);
      reactionTimer = undefined;
    }
    setReaction(null);
  }

  function playReaction(next: PetReaction, durationMs?: number): void {
    if (reactionTimer !== undefined) clearTimeout(reactionTimer);
    setReaction(next);
    if (durationMs === undefined) return;
    reactionTimer = setTimeout(() => {
      reactionTimer = undefined;
      setReaction(null);
    }, durationMs);
  }

  async function moveWindow(mode: PetMovement): Promise<void> {
    if (
      typeof window === "undefined" ||
      window.__TAURI_INTERNALS__ === undefined ||
      mode === "fixed"
    ) {
      return;
    }
    const monitor = await currentMonitor();
    if (monitor === null) return;
    const win = getCurrentWindow();
    const [size, position] = await Promise.all([win.outerSize(), win.outerPosition()]);
    const area = monitor.workArea;
    const maxX = Math.max(area.position.x, area.position.x + area.size.width - size.width);
    const maxY = Math.max(area.position.y, area.position.y + area.size.height - size.height);
    const step = 18;
    const x = Math.min(
      maxX,
      Math.max(area.position.x, position.x + Math.round((Math.random() * 2 - 1) * step)),
    );
    const y =
      mode === "bottom"
        ? maxY
        : Math.min(
            maxY,
            Math.max(area.position.y, position.y + Math.round((Math.random() * 2 - 1) * step)),
          );
    await win.setPosition(new PhysicalPosition(x, y));
  }

  function restartMovement(): void {
    if (movementTimer !== undefined) clearInterval(movementTimer);
    movementTimer = undefined;
    if (movement() === "fixed") return;
    void moveWindow(movement()).catch(() => {
      // Window movement is best-effort on platforms without position access.
    });
    movementTimer = setInterval(
      () => {
        void moveWindow(movement()).catch(() => {
          // Ignore transient monitor/window errors.
        });
      },
      movement() === "bottom" ? 3600 : 3000,
    );
  }

  function applyExternalPrefs(prefs: PetPrefsPayload): void {
    if (prefs.selectedPackId !== undefined) setSelectedPackId(prefs.selectedPackId);
    if (prefs.movement !== undefined) {
      setMovement(prefs.movement);
      restartMovement();
    }
    if (prefs.size !== undefined) setSize(prefs.size);
    if (prefs.opacity !== undefined) setOpacity(prefs.opacity);
  }

  onMount(() => {
    // The global app stylesheet gives body a solid theme background. A
    // separate transparent Tauri webview must explicitly clear it or the
    // pet appears inside a square opaque frame instead of blending with the
    // client behind it.
    const transparentLayers = [
      document.documentElement,
      document.body,
      document.getElementById("root"),
    ]
      .filter((element): element is HTMLElement => element !== null)
      .map((element) => ({ element, style: element.getAttribute("style") }));
    for (const { element } of transparentLayers) {
      element.style.background = "transparent";
    }

    // Re-apply the persisted settings to Rust (size/opacity/topmost/mute/
    // dock/click-through) so a fresh window matches the stored prefs; a
    // rejected IPC is swallowed — the defaults remain in effect.
    void applyPetPrefs().catch(() => {
      // Nothing to report: the window defaults still apply.
    });
    const requestedPackId = selectedPackId();
    void refreshPetPacks()
      .then(() => {
        const resolved = resolvedPetPackId(requestedPackId);
        if (resolved === requestedPackId) return;
        setSelectedPackId(resolved);
        savePetPrefs({ ...loadPetPrefs(), selectedPackId: resolved });
        void notifyPetPrefsChanged({ selectedPackId: resolved });
      })
      .catch(() => {
        // The persisted default remains available when the registry is unavailable.
      });
    const stopState = subscribeToPetState((next) => {
      setLastForwarded(next);
      setState(next);
      // A forwarded state supersedes a local headpat.
      if (next !== "attention" && headpatTimer !== undefined) clearHeadpat();
    });
    const stopIntensity = subscribeToPetIntensity(setIntensity);
    const stopPrefs = subscribeToPetPrefs(applyExternalPrefs);
    restartMovement();
    onCleanup(() => {
      for (const { element, style } of transparentLayers) {
        if (style === null) element.removeAttribute("style");
        else element.setAttribute("style", style);
      }
      stopState();
      stopIntensity();
      stopPrefs();
      if (movementTimer !== undefined) clearInterval(movementTimer);
      clearClickTimer();
      clearHeadpat();
      clearReaction();
    });
  });

  function startWindowDrag(event: MouseEvent): void {
    if (event.button !== 0 || collapsed()) return;
    playReaction("press", 180);
    if (typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined) {
      void getCurrentWindow()
        .startDragging()
        .then(() => playReaction("dragStart", 180))
        .catch(() => {
          // The data-tauri-drag-region attribute remains as a native fallback.
        });
    }
  }

  /** Headpat easter egg: bounce + heart for the attention lifetime. */
  function headpat() {
    if (collapsed()) return;
    clickTimer = undefined;
    setHeadpatActive(true);
    playReaction("tap", TRANSIENT_MS.attention);
    setState("attention");
    if (headpatTimer !== undefined) clearTimeout(headpatTimer);
    headpatTimer = setTimeout(() => {
      headpatTimer = undefined;
      setHeadpatActive(false);
      clearReaction();
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
    // is gone.
    setState(lastForwarded());
    const next = !collapsed();
    setCollapsed(next);
    void setPetSize(next ? COLLAPSED_SIZE : size());
  }

  function handleMouseEnter(): void {
    if (!headpatActive() && !collapsed()) playReaction("hover");
  }

  function handleMouseLeave(): void {
    if (!headpatActive()) clearReaction();
  }

  function handleMouseUp(): void {
    if (!collapsed()) playReaction("drop", 700);
  }

  // Keep the hit area nearly identical to the rendered companion. A smaller
  // inner canvas made the transparent window feel like an invisible square.
  const blobSize = () => (collapsed() ? 30 : Math.max(1, size() - 8));
  return (
    <div
      data-testid="pet-shell"
      data-pet-state={state()}
      data-tauri-drag-region="deep"
      style={{ opacity: opacity() }}
      onMouseDown={startWindowDrag}
      class="pet-window-shell flex h-full w-full select-none items-end justify-start bg-transparent pb-2 pl-2"
    >
      <div class="relative">
        <div
          data-testid="pet-blob"
          data-pet-state={state()}
          data-pet-pack={selectedPackId()}
          data-headpat={headpatActive() ? "true" : "false"}
          data-collapsed={collapsed() ? "true" : "false"}
          class="pet-blob relative flex items-end justify-center"
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
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onMouseUp={handleMouseUp}
          title={collapsed() ? t("pet:doubleClickToRestore") : t("pet:clickToPet")}
        >
          <PetSurface
            packId={selectedPackId() ?? "dev.opencoder.byte"}
            state={state()}
            intensity={intensity()}
            size={blobSize()}
            reaction={reaction()}
          />
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
      </div>
    </div>
  );
};

export default PetShell;
