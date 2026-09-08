// Pure pagination merge logic (TASK-M3-05): how a freshly fetched message
// page combines with the ids already in the messages store. Kept free of
// Solid/store imports so the L1 tests exercise the merge rules directly.
//
// Contract assumed of GET /session/{id}/message (see tests/mock-server/routes.ts):
// - each page is ordered chronologically (oldest message first);
// - `limit` without `before` returns the MOST RECENT page;
// - `before` returns the page strictly older than the given message id
//   (unknown ids yield an empty page).
//
// Cursor rules:
// - the next cursor is always the page's oldest id, but only when the page
//   actually moved OLDER than the requested cursor — a server that ignores
//   `before` and replays the same page is detected via the unchanged oldest
//   id and terminates pagination (hasMore false, no cursor) instead of
//   looping forever;
// - a full page (length === pageSize) implies more history, a short or
//   empty page implies the end.

import type { SessionMessage } from "../../services/message.js";

export interface PageMerge {
  /** Ids of the page messages not yet in the store, oldest first. */
  added: string[];
  /** Cursor for the next (older) page, or undefined when paging is done. */
  nextCursor: string | undefined;
  /** Whether another earlier page may exist. */
  hasMore: boolean;
  /** Why pagination stopped, when this page terminates the history. */
  stopReason?: "exhausted" | "short-page" | "cursor-replay";
  /** True when this page moved the cursor but every record was already known. */
  duplicateOnly: boolean;
}

export function mergePages(
  known: ReadonlySet<string>,
  page: SessionMessage[],
  pageSize: number,
  cursor?: string,
  seenCursors: ReadonlySet<string> = new Set(),
): PageMerge {
  const oldestId = page[0]?.info.id;
  const added = page.map((item) => item.info.id).filter((id) => !known.has(id));
  const advanced =
    cursor === undefined ||
    (oldestId !== undefined && oldestId !== cursor && !seenCursors.has(oldestId));
  const stopReason =
    page.length === 0
      ? "exhausted"
      : !advanced
        ? "cursor-replay"
        : page.length < pageSize
          ? "short-page"
          : undefined;
  return {
    added,
    nextCursor: page.length === 0 || !advanced ? undefined : oldestId,
    hasMore: stopReason === undefined,
    stopReason,
    duplicateOnly: added.length === 0 && advanced,
  };
}
