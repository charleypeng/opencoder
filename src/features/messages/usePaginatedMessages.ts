// usePaginatedMessages (TASK-M3-05): owns the "load older messages" state of
// the transcript. loadInitial() fetches the most recent page on session
// open; loadEarlier() fetches the next older page, merges it into the
// messages store in FRONT of the already rendered history (id-deduplicated
// by the store) and reports how many NEW messages arrived — the caller uses
// that count to re-anchor the scroll position. Both calls are version
// guarded, so a session switch while a page is in flight drops the stale
// response instead of applying it to the wrong session.

import { createEffect, createMemo, createSignal } from "solid-js";
import { createMessageService, type SessionMessage } from "../../services/message.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { projects } from "../../stores/project.js";
import {
  applyMessageBatch,
  getServerMessages,
  type MessageBatchItem,
} from "../../stores/messages.js";
import { mergeExpandedWindow, mergePages, type PageMerge } from "./pagination.js";

/** Messages per page request; a full page is also the hasMore heuristic. */
export const HISTORY_PAGE_SIZE = 50;

export type HistoryPhase =
  | "initial-loading"
  | "seeking-visible"
  | "ready"
  | "backfilling"
  | "exhausted"
  | "initial-error"
  | "backfill-error";

export interface PageResult {
  received: number;
  inserted: number;
  cursor: string | undefined;
  hasMore: boolean;
  stopReason?: PageMerge["stopReason"];
  duplicateOnly: boolean;
  containsCompaction: boolean;
}

export interface PaginatedMessages {
  /** True while a strictly older page may exist (last page came back full). */
  hasMore: () => boolean;
  /** True while an earlier page is being fetched. */
  loadingEarlier: () => boolean;
  /** A request generation covering server, directory, and session. */
  generation: () => string;
  /** Fetches the most recent page. */
  loadInitial: () => Promise<PageResult>;
  /** Fetches the next older page. */
  loadEarlier: () => Promise<PageResult | undefined>;
}

export function usePaginatedMessages(
  getServerId: () => string,
  getSessionId: () => string,
): PaginatedMessages {
  const [hasMore, setHasMore] = createSignal(false);
  const [loadingEarlier, setLoadingEarlier] = createSignal(false);
  const generation = createMemo(() => {
    const serverId = getServerId();
    const directory = projects[serverId]?.current ?? "";
    return `${serverId}\u0000${directory}\u0000${getSessionId()}`;
  });
  // Cursor (oldest server-returned id) and session version live in refs:
  // they are only read inside the async load functions.
  const cursor = { current: undefined as string | undefined };
  const pagingMode = { current: "cursor" as "cursor" | "expanded-window" };
  const expandedLimit = { current: HISTORY_PAGE_SIZE };
  const version = { current: 0 };
  const seenCursors = new Set<string>();

  // Any session/server change resets pagination state; the MessageList
  // mount effect re-runs loadInitial for the new key.
  createEffect(() => {
    generation();
    version.current += 1;
    cursor.current = undefined;
    pagingMode.current = "cursor";
    expandedLimit.current = HISTORY_PAGE_SIZE;
    seenCursors.clear();
    setHasMore(false);
    setLoadingEarlier(false);
  });

  function knownIds(serverId: string, sessionId: string): Set<string> {
    return new Set(Object.keys(getServerMessages(serverId)[sessionId]?.infos ?? {}));
  }

  function toBatchItems(page: SessionMessage[]): MessageBatchItem[] {
    const items: MessageBatchItem[] = [];
    for (const item of page) {
      items.push({ type: "message", info: item.info });
      for (const part of item.parts) items.push({ type: "part", part });
    }
    return items;
  }

  function addedMessages(page: SessionMessage[], added: readonly string[]): SessionMessage[] {
    const addedIds = new Set(added);
    return page.filter((message) => addedIds.has(message.info.id));
  }

  function cursorWasRejected(error: unknown): boolean {
    return ApiError.fromUnknown(error).status === 400;
  }

  function resultFor(page: SessionMessage[], merge: ReturnType<typeof mergePages>): PageResult {
    return {
      received: page.length,
      inserted: merge.added.length,
      cursor: merge.nextCursor,
      hasMore: merge.hasMore,
      stopReason: merge.stopReason,
      duplicateOnly: merge.duplicateOnly,
      containsCompaction: page.some((message) =>
        message.parts.some((part) => part.type === "compaction"),
      ),
    };
  }

  async function loadInitial(): Promise<PageResult> {
    const current = version.current;
    const serverId = getServerId();
    const sessionId = getSessionId();
    const directory = projects[serverId]?.current ?? undefined;
    const service = createMessageService(getApiClient());
    const page = await service.list(sessionId, {
      limit: HISTORY_PAGE_SIZE,
      dir: directory,
    });
    if (current !== version.current) {
      return {
        received: 0,
        inserted: 0,
        cursor: undefined,
        hasMore: false,
        duplicateOnly: false,
        containsCompaction: false,
      };
    }
    const merge = mergePages(knownIds(serverId, sessionId), page, HISTORY_PAGE_SIZE);
    // The batch only upserts, so a page that overlaps live-streamed
    // messages merges instead of duplicating.
    if (merge.added.length > 0) applyMessageBatch(serverId, sessionId, toBatchItems(page));
    cursor.current = merge.nextCursor;
    expandedLimit.current = HISTORY_PAGE_SIZE;
    setHasMore(merge.hasMore);
    if (cursor.current !== undefined) seenCursors.add(cursor.current);
    return resultFor(page, merge);
  }

  async function loadEarlier(): Promise<PageResult | undefined> {
    if (
      (pagingMode.current === "cursor" && cursor.current === undefined) ||
      !hasMore() ||
      loadingEarlier()
    ) {
      return undefined;
    }
    const current = version.current;
    const serverId = getServerId();
    const sessionId = getSessionId();
    const directory = projects[serverId]?.current ?? undefined;
    const service = createMessageService(getApiClient());
    setLoadingEarlier(true);
    try {
      let page: SessionMessage[];
      let merge: PageMerge;
      if (pagingMode.current === "expanded-window") {
        const nextLimit = expandedLimit.current + HISTORY_PAGE_SIZE;
        page = await service.list(sessionId, { limit: nextLimit, dir: directory });
        if (current !== version.current) return undefined;
        merge = mergeExpandedWindow(knownIds(serverId, sessionId), page, nextLimit);
        expandedLimit.current = nextLimit;
      } else {
        try {
          page = await service.list(sessionId, {
            limit: HISTORY_PAGE_SIZE,
            before: cursor.current,
            dir: directory,
          });
          if (current !== version.current) return undefined;
          merge = mergePages(
            knownIds(serverId, sessionId),
            page,
            HISTORY_PAGE_SIZE,
            cursor.current,
            seenCursors,
          );
        } catch (error) {
          if (current !== version.current) return undefined;
          if (!cursorWasRejected(error)) throw error;
          const nextLimit =
            Math.max(expandedLimit.current, knownIds(serverId, sessionId).size) + HISTORY_PAGE_SIZE;
          page = await service.list(sessionId, { limit: nextLimit, dir: directory });
          if (current !== version.current) return undefined;
          merge = mergeExpandedWindow(knownIds(serverId, sessionId), page, nextLimit);
          pagingMode.current = "expanded-window";
          expandedLimit.current = nextLimit;
        }
      }
      if (current !== version.current) return undefined;
      if (merge.added.length > 0) {
        applyMessageBatch(serverId, sessionId, toBatchItems(addedMessages(page, merge.added)), {
          prepend: true,
        });
      }
      cursor.current = merge.nextCursor;
      setHasMore(merge.hasMore);
      if (pagingMode.current === "cursor" && cursor.current !== undefined) {
        seenCursors.add(cursor.current);
      }
      return resultFor(page, merge);
    } finally {
      if (current === version.current) setLoadingEarlier(false);
    }
  }

  return { hasMore, loadingEarlier, generation, loadInitial, loadEarlier };
}
