// L1 tests for the session-list time grouping (TASK-M2-04): local-day
// buckets (today / yesterday / this week from Monday / earlier) with
// inclusive midnight boundaries, the Monday edge case (last week's weekend
// falls into earlier), empty-group filtering and input-order preservation.

import { describe, expect, it } from "vitest";
import type { Session } from "../../services/session.js";
import { groupSessionsByTime } from "./timeGroups.js";

function session(id: string, updated: number): Session {
  return {
    id,
    slug: id,
    projectID: "project-mock-1",
    directory: "/mock/projects/opencode-demo",
    title: id,
    version: "1.18.11",
    time: { created: updated, updated },
  } as Session;
}

// Wednesday Aug 5 2026 14:00 local; the Monday of that week is Aug 3.
const NOW = new Date(2026, 7, 5, 14, 0, 0, 0).getTime();

describe("groupSessionsByTime", () => {
  it("buckets sessions into today, yesterday, this week and earlier with labels", () => {
    const groups = groupSessionsByTime(
      [
        session("earlier", new Date(2026, 7, 2, 9, 0).getTime()), // last Sunday
        session("week", new Date(2026, 7, 3, 9, 0).getTime()), // Monday
        session("yesterday", new Date(2026, 7, 4, 9, 0).getTime()),
        session("today", new Date(2026, 7, 5, 9, 0).getTime()),
      ],
      NOW,
    );

    expect(groups.map((g) => g.key)).toEqual(["today", "yesterday", "thisWeek", "earlier"]);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "This Week", "Earlier"]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["today"]);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(["yesterday"]);
    expect(groups[2].sessions.map((s) => s.id)).toEqual(["week"]);
    expect(groups[3].sessions.map((s) => s.id)).toEqual(["earlier"]);
  });

  it("treats local midnight boundaries as inclusive of the newer group", () => {
    const groups = groupSessionsByTime(
      [
        session("last-ms", new Date(2026, 7, 2, 23, 59, 59, 999).getTime()),
        session("monday-midnight", new Date(2026, 7, 3, 0, 0, 0, 0).getTime()),
        session("yesterday-midnight", new Date(2026, 7, 4, 0, 0, 0, 0).getTime()),
        session("today-midnight", new Date(2026, 7, 5, 0, 0, 0, 0).getTime()),
      ],
      NOW,
    );

    expect(groups[0].sessions.map((s) => s.id)).toEqual(["today-midnight"]);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(["yesterday-midnight"]);
    expect(groups[2].sessions.map((s) => s.id)).toEqual(["monday-midnight"]);
    expect(groups[3].sessions.map((s) => s.id)).toEqual(["last-ms"]);
  });

  it("on Monday, Sunday is yesterday and the week bucket stays empty", () => {
    const mondayNow = new Date(2026, 7, 3, 10, 0, 0, 0).getTime();
    const groups = groupSessionsByTime(
      [
        session("saturday", new Date(2026, 7, 1, 9, 0).getTime()),
        session("sunday", new Date(2026, 7, 2, 9, 0).getTime()),
        session("monday", new Date(2026, 7, 3, 9, 0).getTime()),
      ],
      mondayNow,
    );

    expect(groups.map((g) => g.key)).toEqual(["today", "yesterday", "earlier"]);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(["sunday"]);
    expect(groups[2].sessions.map((s) => s.id)).toEqual(["saturday"]);
  });

  it("drops empty groups", () => {
    const groups = groupSessionsByTime(
      [session("today", new Date(2026, 7, 5, 9, 0).getTime())],
      NOW,
    );
    expect(groups).toEqual([
      { key: "today", label: "Today", sessions: [expect.objectContaining({ id: "today" })] },
    ]);
  });

  it("preserves the input order within each group", () => {
    const groups = groupSessionsByTime(
      [
        session("yesterday-b", new Date(2026, 7, 4, 10, 0).getTime()),
        session("today-a", new Date(2026, 7, 5, 8, 0).getTime()),
        session("today-b", new Date(2026, 7, 5, 9, 0).getTime()),
      ],
      NOW,
    );

    expect(groups[0].sessions.map((s) => s.id)).toEqual(["today-a", "today-b"]);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(["yesterday-b"]);
  });
});
