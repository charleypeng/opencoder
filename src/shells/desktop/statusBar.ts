// Status bar helpers (TASK-M9-07): pure formatting functions for the
// tokens/cost chip. The chip reads the ACTIVE session from the session
// store — the server-computed `tokens` (input + output + reasoning;
// cache reads/writes are excluded from the usage figure) and `cost`
// fields of the 1.18.11 Session schema, kept fresh by `session.updated`
// events (documented decision: server-side accounting beats client-side
// estimation from message text).

import type { Session } from "../../services/session.js";

/** Rounds 0.035 -> 0.04 / 0.005 -> 0.01 for display (never shows 0¢). */
export function formatCost(cost: number | undefined): string {
  if (typeof cost !== "number" || !Number.isFinite(cost)) return "$0.00";
  return `$${cost.toFixed(2)}`;
}

/** 1234 -> "1.2K", 2500000 -> "2.5M"; small counts stay verbatim. */
export function formatTokens(tokens: number | undefined): string {
  if (typeof tokens !== "number" || !Number.isFinite(tokens)) return "0";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(Math.round(tokens));
}

/** Usage figure of a session: input + output + reasoning tokens and cost. */
export interface SessionUsage {
  tokens: number;
  cost: number;
}

/** Derives the usage display values from a session (undefined = nothing). */
export function usageOf(session: Session | undefined): SessionUsage | undefined {
  if (session === undefined) return undefined;
  const t = session.tokens;
  if (t === undefined) return undefined;
  const { input = 0, output = 0, reasoning = 0 } = t;
  const tokens = input + output + reasoning;
  if (tokens <= 0 && (session.cost ?? 0) <= 0) return undefined;
  return { tokens, cost: session.cost ?? 0 };
}
