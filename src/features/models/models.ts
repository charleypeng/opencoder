// Pure model-picker helpers (TASK-M5-05): the capability badge filter
// (tools/vision/reasoning from the capabilities field), the cost and
// context-limit hint formatters, the model reference key, and the
// localStorage-backed favorites list (keyed "providerID:modelID" under
// `oc-fav-models`).

import type { Model } from "../../services/provider.js";

/** localStorage key for the favorite model ids ("providerID:modelID"). */
export const FAVORITES_STORAGE_KEY = "oc-fav-models";

/** A capability badge shown on a model row. */
export type ModelCapabilityBadge = "tools" | "vision" | "reasoning";

/** The model's display name (falls back to its id). */
export function modelName(model: Model): string {
  return model.name ?? model.id;
}

/** The capability badges to show: tools (toolcall), vision (image input) and reasoning. */
export function capabilityBadges(model: Model): ModelCapabilityBadge[] {
  const badges: ModelCapabilityBadge[] = [];
  if (model.capabilities?.toolcall === true) badges.push("tools");
  if (model.capabilities?.input?.image === true) badges.push("vision");
  if (model.capabilities?.reasoning === true) badges.push("reasoning");
  return badges;
}

function formatPrice(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
/**
 * The per-million-token price hint, e.g. "$1.25/M in · $10/M out"
 * (costs are per 1M tokens in the contract); null when the model
 * carries no usable price.
 */
export function formatCost(model: Model): string | null {
  const input = model.cost?.input;
  const output = model.cost?.output;
  if (typeof input !== "number" || typeof output !== "number") return null;
  return `$${formatPrice(input)}/M in · $${formatPrice(output)}/M out`;
}

/**
 * The context-limit hint, e.g. "400K context" (tokens, rounded to the
 * nearest thousand); null when the model carries no context limit.
 */
export function formatContextLimit(model: Model): string | null {
  const context = model.limit?.context;
  if (typeof context !== "number") return null;
  return `${Math.round(context / 1000)}K context`;
}

/** Stable key for a model reference ("providerID:modelID"). */
export function modelRefKey(providerID: string, modelID: string): string {
  return `${providerID}:${modelID}`;
}

/** Parses the favorites list from localStorage; tolerant of bad data. */
export function loadFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/** Persists the favorites list to localStorage. */
export function saveFavorites(favorites: readonly string[]): void {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // Storage unavailable (private mode / quota): favorites stay in-memory.
  }
}

/** Pure toggle: adds the key when absent, removes it when present. */
export function toggleFavorite(favorites: readonly string[], key: string): string[] {
  return favorites.includes(key) ? favorites.filter((entry) => entry !== key) : [...favorites, key];
}

/** Whether the model key is in the favorites list. */
export function isFavorite(favorites: readonly string[], key: string): boolean {
  return favorites.includes(key);
}
