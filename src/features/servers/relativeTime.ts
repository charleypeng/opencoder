// Relative-time formatting for the server cards (TASK-M1-06).

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Formats an epoch-millis timestamp as a short relative string ("just now",
 * "5m ago", "2h ago", "3d ago"); older timestamps fall back to a locale date.
 */
export function formatRelativeTime(timestampMs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - timestampMs);
  if (diff < MINUTE_MS) return "just now";
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d ago`;
  return new Date(timestampMs).toLocaleDateString();
}
