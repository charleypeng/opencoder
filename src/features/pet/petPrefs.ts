// Pet window preference persistence (TASK-M8-07): the pet window owns its
// display settings (size / opacity / topmost / mute / edge dock / click-
// through) in its own localStorage (`oc-pet`) and re-applies them through
// the Rust commands at mount, so the settings survive restarts even though
// the window itself is created by Rust with the defaults. Follows the
// desktopPrefs discipline: malformed payloads dropped, field shapes
// validated, storage failures swallowed.

import {
  setPetDock,
  setPetIgnoreMouse,
  setPetMute,
  setPetOpacity,
  setPetSize,
  setPetTopmost,
} from "../../services/pet.js";
import { BOX_CAT_PET_PACK_ID, DEFAULT_PET_PACK_ID } from "./packTypes.js";

export type PetType = "blob" | "cat" | "dog" | "robot";
export type PetMovement = "fixed" | "roam" | "bottom";

const legacyPackIds: Record<PetType, string> = {
  blob: DEFAULT_PET_PACK_ID,
  cat: BOX_CAT_PET_PACK_ID,
  dog: DEFAULT_PET_PACK_ID,
  robot: DEFAULT_PET_PACK_ID,
};

export function legacyPetTypeToPackId(type: PetType): string {
  return legacyPackIds[type];
}

export function packIdToLegacyPetType(id: string | undefined): PetType {
  return id === BOX_CAT_PET_PACK_ID ? "cat" : "robot";
}

/** Display settings of the pet window (absent fields = defaults). */
export interface PetPrefs {
  /** Selected data-only pet pack. */
  selectedPackId?: string;
  /** Screen movement behavior. */
  movement?: PetMovement;
  /** Window edge length in px (120-200). */
  size?: number;
  /** Window content opacity (0.4-1.0). */
  opacity?: number;
  /** Whether the window stays above other windows. */
  topmost?: boolean;
  /** Whether pet sounds are muted. The sprite pet is silent (TASK-M8-08
   *  consumes the flag as a no-op); a future sound renderer gates on it. */
  mute?: boolean;
  /** Whether drags snap to screen edges. */
  dock?: boolean;
  /** Whether pointer events pass through the window. */
  clickThrough?: boolean;
}

const KEY = "oc-pet";

/** Reads the persisted pet prefs; malformed payloads yield {} (the
 *  defaults in PetShell stay in effect). */
export function loadPetPrefs(): PetPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { selectedPackId: DEFAULT_PET_PACK_ID };
    const parsed = JSON.parse(raw) as Partial<PetPrefs> & { petType?: unknown };
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const prefs: PetPrefs = {};
    if (typeof parsed.selectedPackId === "string" && validPackId(parsed.selectedPackId)) {
      prefs.selectedPackId = parsed.selectedPackId;
    } else if (isLegacyPetType(parsed.petType)) {
      prefs.selectedPackId = legacyPetTypeToPackId(parsed.petType);
    } else {
      prefs.selectedPackId = DEFAULT_PET_PACK_ID;
    }
    if (parsed.movement === "fixed" || parsed.movement === "roam" || parsed.movement === "bottom") {
      prefs.movement = parsed.movement;
    }
    if (typeof parsed.size === "number" && Number.isInteger(parsed.size)) {
      prefs.size = Math.min(200, Math.max(120, parsed.size));
    }
    if (typeof parsed.opacity === "number") {
      prefs.opacity = Math.min(1, Math.max(0.4, parsed.opacity));
    }
    if (typeof parsed.topmost === "boolean") prefs.topmost = parsed.topmost;
    if (typeof parsed.mute === "boolean") prefs.mute = parsed.mute;
    if (typeof parsed.dock === "boolean") prefs.dock = parsed.dock;
    if (typeof parsed.clickThrough === "boolean") prefs.clickThrough = parsed.clickThrough;
    return prefs;
  } catch {
    return {};
  }
}

function isLegacyPetType(value: unknown): value is PetType {
  return value === "blob" || value === "cat" || value === "dog" || value === "robot";
}

function validPackId(value: string): boolean {
  return (
    value.length <= 128 &&
    value.includes(".") &&
    /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)
  );
}

/** Persists the pet prefs; storage failures (private mode) are swallowed
 *  — the current session keeps working. */
export function savePetPrefs(prefs: PetPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: nothing to persist, nothing to report.
  }
}

/** Applies the stored prefs to the Rust runtime (called by PetShell on
 *  mount). Only stored fields are pushed; absent fields keep the window
 *  defaults (160px, full opacity, topmost, dock enabled, clickable). */
export async function applyPetPrefs(): Promise<void> {
  const prefs = loadPetPrefs();
  if (prefs.size !== undefined) await setPetSize(prefs.size);
  if (prefs.opacity !== undefined) await setPetOpacity(prefs.opacity);
  if (prefs.topmost !== undefined) await setPetTopmost(prefs.topmost);
  if (prefs.mute !== undefined) await setPetMute(prefs.mute);
  if (prefs.dock !== undefined) await setPetDock(prefs.dock);
  if (prefs.clickThrough !== undefined) await setPetIgnoreMouse(prefs.clickThrough);
}
