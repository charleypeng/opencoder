// Message history list (TASK-M2-06 / M2-09 / M3-05): the main pane's chat
// transcript for one session. On mount (and whenever the session changes)
// the MOST RECENT page of history is fetched from GET /session/{id}/message
// and merged into the normalized messages store in ONE batched store pass
// (applyMessageBatch); live SSE updates keep applying on top afterwards
// (the fetch only upserts, so nothing is ever dropped).
//
// Pagination (TASK-M3-05): scrolling to the top of the list triggers a load
// of the next older page (limit + before cursor); the page is PREPENDED to
// the store so render order stays chronological, deduplicated by message id,
// and the scroll position is re-anchored to the previously visible content
// (the viewport's scrollTop grows by exactly the height of the inserted
// rows), so the list never jumps. A thin spinner sits above the chat area
// while an earlier page is in flight; when the last page comes back short,
// hasMore flips false and no further requests are made.
//
// Rendering (TASK-M2-09 streaming pipeline):
// - messages are grouped by id through the store's `messageParts` map, which
//   is replaced only when part membership changes — streaming text deltas
//   never re-run the grouping memo;
// - the transcript is virtualized (createVirtualList): only the rows that
//   intersect the viewport (plus overscan) are mounted, so long transcripts
//   render a constant handful of bubbles;
// - each message renders through MessageBubble, which subscribes to its own
//   info/parts individually — a delta updates exactly one part row;
// - while the session is generating, a thin indeterminate progress bar sits
//   at the top of the chat area (single source: session busy status), and
//   the breathing typing caret follows the streaming message's last token;
// - auto-scroll pins the bottom while the user is near it; scrolling up
//   pauses the follow and a "New messages" button jumps back.

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { ApiError } from "../../services/errors.js";
import { messages } from "../../stores/messages.js";
import { sessions } from "../../stores/session.js";
import MessageBubble from "./MessageBubble.js";
import { createVirtualList } from "./useVirtualList.js";
import { usePaginatedMessages } from "./usePaginatedMessages.js";
import { useStreamingIndicator } from "./useStreamingIndicator.js";

export interface MessageListProps {
  /** The server whose session is shown. */
  serverId: string;
  /** The session to render. */
  sessionId: string;
  /** Opens the M4 diff view filtered to one message (wired by M4-07). */
  onViewDiff?: (messageID: string) => void;
  /** Forks the session from a message point (wired by M6-03). */
  onFork?: (messageID: string) => void;
  /** Reverts the session to a message point (wired by M6-04 — the caller
   *  shows the confirm dialog). */
  onRevert?: (messageID: string) => void;
  /** Unreverts the session in one click (wired by M6-04). */
  onUnrevert?: () => void;
  /** Opens the child session of a session owning a subtask part (wired by
   *  M6-07). */
  onOpenChild?: (sessionId: string) => void;
}

interface MessageGroup {
  messageID: string;
  partIds: string[];
}

/** Default height of a message row before measurement, in px. */
const ROW_ESTIMATE_PX = 96;

/** Scroll offset from the top (px) that triggers loading an older page. */
const EARLIER_TRIGGER_PX = 40;

// A mounted row: the virtual position plus the group data it renders. Row
// objects are REUSED (same reference) as long as nothing about them changed,
// so For's identity diff keeps the corresponding DOM/bubble instances alive —
// a regroup or scroll only re-creates the rows that actually changed.
interface MessageRow {
  index: number;
  start: number;
  height: number;
  messageID: string;
  partIds: string[];
  typing: boolean;
  /** True when this message sits AFTER the session's revert point (M6-04). */
  reverted: boolean;
}

const MessageList: Component<MessageListProps> = (props) => {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<ApiError | null>(null);
  const [loadKey, setLoadKey] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [hasNew, setHasNew] = createSignal(false);
  let scrollRef: HTMLDivElement | undefined;
  let fetchVersion = 0;
  let suppressUntil = 0;
  let lastGroupCount = 0;
  let lastDeltaStamp = 0;
  // True while an older page is being inserted; the follow effect checks it
  // so a PREPENDED page never flags the "New messages" jump button. It is a
  // plain ref (not a signal): the effect flush happens after loadEarlier's
  // synchronous part, so a signal would already read false.
  let prepending = false;

  const pagination = usePaginatedMessages(
    () => props.serverId,
    () => props.sessionId,
  );

  const streaming = useStreamingIndicator(
    () => props.serverId,
    () => props.sessionId,
  );

  // Message groups: derived from the store's messageParts map, which is
  // replaced only when part membership changes. A text delta never
  // re-evaluates this memo, so streaming tokens leave the grouping alone
  // (the M2-06 implementation re-grouped the whole transcript per delta).
  const groups = createMemo<MessageGroup[]>(() => {
    const map = messages[props.serverId]?.[props.sessionId]?.messageParts;
    if (map === undefined) return [];
    const out: MessageGroup[] = [];
    for (const [messageID, partIds] of Object.entries(map)) {
      if (partIds.length === 0) continue;
      out.push({ messageID, partIds });
    }
    return out;
  });

  const list = createVirtualList(
    () => scrollRef,
    () => groups().length,
    // Rows are measured by MESSAGE ID, so a page PREPENDED by pagination
    // leaves the shifted-down rows with their measured heights and the new
    // rows start at the estimate: the re-anchor delta is exactly the height
    // of the inserted rows (index-keyed measurements would attribute stale
    // heights to the new indices and make the delta hundreds of px off).
    (index) => groups()[index]?.messageID ?? `row-${index}`,
    {
      estimate: ROW_ESTIMATE_PX,
    },
  );

  // The message whose last text part carries the typing caret: the LAST
  // group with a text part, while the session is streaming.
  const cursorMessageId = createMemo(() => {
    if (!streaming.streaming()) return undefined;
    const gs = groups();
    for (let i = gs.length - 1; i >= 0; i--) {
      const partIds = gs[i].partIds;
      for (let j = partIds.length - 1; j >= 0; j--) {
        const type = messages[props.serverId]?.[props.sessionId]?.parts[partIds[j]]?.type;
        if (type === "text") return gs[i].messageID;
      }
    }
    return undefined;
  });

  // Revert point (TASK-M6-04): the session's `revert.messageID` — set by
  // the revert response (and cleared by unrevert), both stored via
  // upsertSession. Messages AFTER the point were undone server-side and
  // render grayed behind the reverted bar.
  const revertMessageId = createMemo(
    () => sessions[props.serverId]?.sessions[props.sessionId]?.revert?.messageID,
  );

  // Index of the revert point within the loaded groups; -1 when the point
  // message is not (yet) loaded or the session is not reverted.
  const revertIndex = createMemo(() => {
    const point = revertMessageId();
    if (point === undefined) return -1;
    const gs = groups();
    for (let i = 0; i < gs.length; i++) {
      if (gs[i].messageID === point) return i;
    }
    return -1;
  });

  // Mounted rows: virtual positions resolved against the current groups.
  // Row objects keep their identity while start/height/partIds/typing stay
  // unchanged, so per-token deltas (which touch none of these) leave every
  // mounted bubble untouched, and a new message only creates its own row.
  const rowCache = new Map<number, MessageRow>();
  const rows = createMemo<MessageRow[]>(() => {
    const virtual = list.rows();
    const gs = groups();
    const cursor = cursorMessageId();
    const revert = revertIndex();
    const out: MessageRow[] = [];
    for (const v of virtual) {
      const group = gs[v.index];
      if (group === undefined) continue;
      const typing = cursor === group.messageID;
      const reverted = revert >= 0 && v.index > revert;
      const prev = rowCache.get(v.index);
      if (
        prev !== undefined &&
        prev.start === v.start &&
        prev.height === v.height &&
        prev.messageID === group.messageID &&
        prev.partIds === group.partIds &&
        prev.typing === typing &&
        prev.reverted === reverted
      ) {
        out.push(prev);
        continue;
      }
      const row: MessageRow = {
        index: v.index,
        start: v.start,
        height: v.height,
        messageID: group.messageID,
        partIds: group.partIds,
        typing,
        reverted,
      };
      rowCache.set(v.index, row);
      out.push(row);
    }
    return out;
  });

  // History fetch: re-runs on session/server change and on retry. A version
  // counter rejects stale responses so fast session switches can't apply
  // the wrong history. Only the MOST RECENT page is fetched here — older
  // pages load lazily via loadEarlier on top-reach (TASK-M3-05).
  createEffect(() => {
    // Reactive keys: the reads re-run this effect on session/server change.
    void props.serverId;
    void props.sessionId;
    loadKey(); // tracked so retry re-runs the fetch
    const version = ++fetchVersion;
    setLoading(true);
    setError(null);
    setPaused(false);
    setHasNew(false);
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void (async () => {
      try {
        await pagination.loadInitial();
        if (cancelled || version !== fetchVersion) return;
        setLoading(false);
      } catch (err) {
        if (cancelled || version !== fetchVersion) return;
        setError(ApiError.fromUnknown(err));
        setLoading(false);
      }
    })();
  });

  // Loads the next older page and re-anchors the viewport on the previously
  // visible content: rows are PREPENDED, so the content below the insertion
  // point shifts down by exactly the inserted height — restoring the saved
  // scrollTop plus that height keeps the transcript visually still. The
  // height delta comes from the virtualizer's (measured) total height, and
  // because measurements are keyed by message id the delta is exactly the
  // inserted rows' heights (real ones once they mount and measure, the
  // estimate otherwise) — never stale heights of the shifted rows.
  // Earlier-load failures stay silent: the next top-reach simply retries.
  async function loadEarlier() {
    if (pagination.loadingEarlier() || !pagination.hasMore()) return;
    const el = scrollRef;
    const anchorTop = el?.scrollTop ?? list.scrollTop();
    const beforeTotal = list.totalHeight();
    prepending = true;
    try {
      const inserted = await pagination.loadEarlier();
      if (inserted === 0) return;
      // Solid flushes effects on a microtask; wait one macrotask so the new
      // rows are mounted (and measured) before the total height is read.
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Skip the correction if the user scrolled while the page was in
      // flight: the saved anchor no longer matches the viewport, so applying
      // the delta would yank the list against the user's scroll (flicker).
      if (scrollRef === undefined || scrollRef.scrollTop !== anchorTop) return;
      list.measure();
      const delta = list.totalHeight() - beforeTotal;
      if (delta > 0) list.scrollTo(anchorTop + delta);
    } catch {
      // Handled by the caller's retry on the next scroll.
    } finally {
      prepending = false;
    }
  }

  // Auto-scroll: while the user is not paused, pin the bottom whenever the
  // transcript grows (new groups) or a streamed delta lands; while paused,
  // either one flags the jump button. The lastDeltaAt subscription fires
  // per delta at O(1) — no part scanning. A page PREPENDED by pagination
  // grows the transcript but must never flag the jump button (it is a
  // history backfill, not new content).
  createEffect(() => {
    const count = groups().length;
    const stamp = messages[props.serverId]?.[props.sessionId]?.lastDeltaAt ?? 0;
    if (count > lastGroupCount || stamp !== lastDeltaStamp) {
      if (paused() && !prepending) setHasNew(true);
    }
    lastGroupCount = count;
    lastDeltaStamp = stamp;
    const el = scrollRef;
    if (el === undefined || paused()) return;
    list.scrollTo(Math.max(0, list.totalHeight() - list.viewport()), "auto");
  });

  // First layout pass: read the real viewport size (also on window resize).
  const onResize = () => list.measure();
  onMount(() => {
    list.measure();
    window.addEventListener("resize", onResize);
  });
  onCleanup(() => {
    window.removeEventListener("resize", onResize);
  });

  function handleScroll(event: Event) {
    const el = event.currentTarget as HTMLDivElement;
    list.onScroll(el);
    if (Date.now() < suppressUntil) return;
    // TASK-M3-05: reaching the top of the list loads the next older page
    // (scroll position is restored by loadEarlier's re-anchor).
    if (list.scrollTop() <= EARLIER_TRIGGER_PX) {
      void loadEarlier();
    }
    const nearBottom = list.totalHeight() - list.scrollTop() - list.viewport() <= 80;
    if (nearBottom) {
      if (hasNew()) setHasNew(false);
      setPaused(false);
    } else {
      setPaused(true);
    }
  }

  function jumpToBottom() {
    const el = scrollRef;
    if (el === undefined) return;
    // Ignore scroll events during the smooth animation so the follow state
    // only changes when the user (or the animation end) reaches the bottom.
    suppressUntil = Date.now() + 800;
    setPaused(false);
    setHasNew(false);
    list.scrollToIndex(groups().length - 1, "smooth");
  }

  return (
    <div data-testid="message-list" class="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* M2-09: thin indeterminate progress bar while the session generates. */}
      <Show when={streaming.busy()}>
        <div data-testid="streaming-progress" class="h-0.5 shrink-0" aria-hidden="true">
          <div class="streaming-progress-bar" />
        </div>
      </Show>
      {/* M3-05: thin spinner above the chat area while an older history
          page loads. It lives OUTSIDE the scroll container so appearing /
          disappearing never shifts the transcript. */}
      <Show when={pagination.loadingEarlier()}>
        <div
          data-testid="message-loading-earlier"
          class="flex h-6 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <span class="inline-block h-3 w-3 animate-n rounded-full border-2 border-accent border-t-transparent" />
        </div>
      </Show>
      {/* M6-04: the reverted bar — visible while the session carries a
          revert marker; the one-click Unrevert restores the session. */}
      <Show when={revertMessageId() !== undefined}>
        <div
          data-testid="reverted-bar"
          class="flex shrink-0 items-center gap-3 border-b border-bg-sunken bg-bg-sunken/60 px-4 py-1.5"
        >
          <span class="min-w-0 flex-1 truncate text-xs text-fg-secondary">
            Reverted to message {revertMessageId()} — later messages are inactive and file changes
            were rolled back.
          </span>
          <button
            type="button"
            data-testid="unrevert"
            class="shrink-0 rounded-md border border-accent/40 px-2.5 py-0.5 text-xs text-accent outline-none hover:border-accent focus:border-accent"
            onClick={() => props.onUnrevert?.()}
          >
            Unrevert
          </button>
        </div>
      </Show>
      <div
        ref={scrollRef}
        data-testid="message-list-scroll"
        class="min-h-0 flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        <Show
          when={!loading()}
          fallback={
            <p data-testid="message-loading" class="py-8 text-center text-sm text-fg-secondary">
              Loading messages…
            </p>
          }
        >
          <Show
            when={error()}
            fallback={
              <Show
                when={groups().length > 0}
                fallback={
                  <div data-testid="message-empty" class="py-8 text-center">
                    <p class="text-sm text-fg-secondary">No messages yet</p>
                    <p class="mt-1 text-xs text-fg-faint">
                      Send a prompt to start the conversation.
                    </p>
                  </div>
                }
              >
                <div class="relative" style={{ height: `${list.totalHeight()}px` }}>
                  <For each={rows()}>
                    {(row) => (
                      <div
                        ref={(el) => list.measureRow(row.messageID, el)}
                        data-virtual-row={row.index}
                        data-reverted={row.reverted ? "true" : "false"}
                        class={`absolute left-0 right-0 px-4 pb-4${row.index === 0 ? " pt-4" : ""}${
                          row.reverted ? " opacity-45 saturate-50" : ""
                        }`}
                        style={{ top: `${row.start}px` }}
                      >
                        <MessageBubble
                          serverId={props.serverId}
                          sessionId={props.sessionId}
                          messageID={row.messageID}
                          partIds={row.partIds}
                          typing={row.typing}
                          onViewDiff={props.onViewDiff}
                          onFork={props.onFork}
                          onRevert={props.onRevert}
                          onOpenChild={props.onOpenChild}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            }
          >
            <div class="flex flex-col gap-4 px-4 py-4">
              <ErrorBanner error={error()} onDismiss={() => setError(null)} />
              <button
                type="button"
                data-testid="message-retry"
                class="self-center rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-sm text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary focus:border-fg-faint"
                onClick={() => {
                  setLoadKey((key) => key + 1);
                }}
              >
                Retry
              </button>
            </div>
          </Show>
        </Show>
        <Show when={hasNew() && !loading()}>
          <div class="sticky bottom-3 flex justify-center">
            <button
              type="button"
              data-testid="message-jump"
              class="rounded-full border border-bg-sunken bg-bg-elevated px-3 py-1.5 text-xs text-fg-secondary shadow outline-none hover:border-fg-faint hover:text-fg-primary focus:border-fg-faint"
              onClick={jumpToBottom}
            >
              New messages ↓
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default MessageList;
