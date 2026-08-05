// Time grouping for the session list (TASK-M2-04): buckets sessions into
// local-time day groups — today, yesterday, this week (Monday start) and
// everything earlier. Pure helper with i18n-ready English labels. The
// session list feeds it the store's already-sorted order (most recently
// updated first), so the input order is preserved within each group.

import type { Session } from "../../services/session.js";

export type SessionTimeGroupKey = "today" | "yesterday" | "thisWeek" | "earlier";

export interface SessionTimeGroup {
  key: SessionTimeGroupKey;
  /** i18n resource key of the group label (sessions:today, ...). */
  labelKey: string;
  sessions: Session[];
}

const GROUP_ORDER: SessionTimeGroupKey[] = ["today", "yesterday", "thisWeek", "earlier"];

const GROUP_LABEL_KEYS: Record<SessionTimeGroupKey, string> = {
  today: "sessions:today",
  yesterday: "sessions:yesterday",
  thisWeek: "sessions:thisWeek",
  earlier: "sessions:earlier",
};

/** Start (local midnight) of the day containing `timestampMs`. */
function startOfDay(timestampMs: number): number {
  const d = new Date(timestampMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Start (local Monday 00:00) of the week containing `timestampMs`. */
function startOfWeek(timestampMs: number): number {
  const d = new Date(startOfDay(timestampMs));
  // getDay(): 0 = Sunday, so Monday backtracks 6 days, Tuesday 1, etc.
  // setDate keeps the local midnight across DST transitions.
  const daysBack = d.getDay() === 0 ? 6 : d.getDay() - 1;
  if (daysBack > 0) d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

/**
 * Buckets sessions by `time.updated` against the local-day boundaries of
 * `nowMs`: today, yesterday, this week (Monday start) and earlier. Groups
 * keep the input order and empty groups are dropped.
 */
export function groupSessionsByTime(
  sessions: Session[],
  nowMs: number = Date.now(),
): SessionTimeGroup[] {
  const todayStart = startOfDay(nowMs);
  const yesterdayStart = startOfDay(todayStart - 1);
  const weekStart = startOfWeek(nowMs);

  const buckets: Record<SessionTimeGroupKey, Session[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: [],
  };
  for (const session of sessions) {
    const updated = session.time.updated;
    if (updated >= todayStart) buckets.today.push(session);
    else if (updated >= yesterdayStart) buckets.yesterday.push(session);
    else if (updated >= weekStart) buckets.thisWeek.push(session);
    else buckets.earlier.push(session);
  }

  return GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    labelKey: GROUP_LABEL_KEYS[key],
    sessions: buckets[key],
  }));
}
