// L1 tests for the pagination merge logic (TASK-M3-05): dedupe by id,
// next-cursor advancement, the hasMore heuristic and the defense against a
// server that ignores the `before` cursor (replay detection).

import { describe, expect, it } from "vitest";
import type { SessionMessage } from "../../services/message.js";
import { mergePages } from "./pagination.js";

const SESSION = "ses_abc123";

function message(id: string): SessionMessage {
  return {
    info: {
      id,
      sessionID: SESSION,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
    } as SessionMessage["info"],
    parts: [],
  };
}

function page(from: number, to: number): SessionMessage[] {
  const out: SessionMessage[] = [];
  for (let i = from; i <= to; i++) out.push(message(`msg_${i}`));
  return out;
}

describe("mergePages", () => {
  it("reports every incoming id as added and uses the oldest as cursor", () => {
    const merge = mergePages(new Set(), page(51, 100), 50);
    expect(merge.added).toEqual(Array.from({ length: 50 }, (_, i) => `msg_${i + 51}`));
    expect(merge.nextCursor).toBe("msg_51");
    expect(merge.hasMore).toBe(true);
  });

  it("excludes ids already known to the store (dedupe)", () => {
    const known = new Set(["msg_51", "msg_52", "msg_60"]);
    const merge = mergePages(known, page(51, 100), 50);
    expect(merge.added).toHaveLength(47);
    expect(merge.added[0]).toBe("msg_53");
    expect(merge.added).not.toContain("msg_51");
    expect(merge.nextCursor).toBe("msg_51");
  });

  it("treats a short page as the end of history", () => {
    const merge = mergePages(new Set(), page(1, 20), 50);
    expect(merge.added).toHaveLength(20);
    expect(merge.nextCursor).toBe("msg_1");
    expect(merge.hasMore).toBe(false);
  });

  it("treats an empty page as the end of history", () => {
    const merge = mergePages(new Set(), [], 50, "msg_1");
    expect(merge.added).toEqual([]);
    expect(merge.nextCursor).toBeUndefined();
    expect(merge.hasMore).toBe(false);
  });

  it("keeps paging while the page advances older than the cursor", () => {
    const merge = mergePages(new Set(), page(1, 50), 50, "msg_51");
    expect(merge.added).toHaveLength(50);
    expect(merge.nextCursor).toBe("msg_1");
    expect(merge.hasMore).toBe(true);
  });

  it("detects a server replaying the same page and stops (no infinite loop)", () => {
    // The store already holds the page (it was the initial load); the server
    // ignores `before` and replays it — the unchanged oldest id terminates.
    const known = new Set(Array.from({ length: 50 }, (_, i) => `msg_${i + 51}`));
    const merge = mergePages(known, page(51, 100), 50, "msg_51");
    expect(merge.added).toEqual([]);
    expect(merge.nextCursor).toBeUndefined();
    expect(merge.hasMore).toBe(false);
  });

  it("keeps the cursor when the page moves older even if everything is known", () => {
    // A revisit: the store already holds the next page from a previous
    // visit — the cursor must still advance so later pages can load.
    const known = new Set(Array.from({ length: 50 }, (_, i) => `msg_${i + 1}`));
    const merge = mergePages(known, page(1, 50), 50, "msg_51");
    expect(merge.added).toEqual([]);
    expect(merge.nextCursor).toBe("msg_1");
    expect(merge.hasMore).toBe(true);
  });
});
