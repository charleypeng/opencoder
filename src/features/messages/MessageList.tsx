// Message history list (TASK-M2-06 / M2-09): the main pane's chat transcript
// for one session. On mount (and whenever the session changes) the history is
// fetched from GET /session/{id}/message and merged into the normalized
// messages store in ONE batched store pass (applyMessageBatch); live SSE
// updates keep applying on top afterwards (the fetch only upserts, so
// nothing is ever dropped).
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
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createMessageService } from "../../services/message.js";
import { getActiveDirectory } from "../../stores/project.js";
import { applyMessageBatch, messages } from "../../stores/messages.js";
import type { MessageBatchItem } from "../../stores/messages.js";
import MessageBubble from "./MessageBubble.js";
import { createVirtualList } from "./useVirtualList.js";
import { useStreamingIndicator } from "./useStreamingIndicator.js";

export interface MessageListProps {
  /** The server whose session is shown. */
  serverId: string;
  /** The session to render. */
  sessionId: string;
}

interface MessageGroup {
  messageID: string;
  partIds: string[];
}

/** Default height of a message row before measurement, in px. */
const ROW_ESTIMATE_PX = 96;

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

  // Mounted rows: virtual positions resolved against the current groups.
  // Row objects keep their identity while start/height/partIds/typing stay
  // unchanged, so per-token deltas (which touch none of these) leave every
  // mounted bubble untouched, and a new message only creates its own row.
  const rowCache = new Map<number, MessageRow>();
  const rows = createMemo<MessageRow[]>(() => {
    const virtual = list.rows();
    const gs = groups();
    const cursor = cursorMessageId();
    const out: MessageRow[] = [];
    for (const v of virtual) {
      const group = gs[v.index];
      if (group === undefined) continue;
      const typing = cursor === group.messageID;
      const prev = rowCache.get(v.index);
      if (
        prev !== undefined &&
        prev.start === v.start &&
        prev.height === v.height &&
        prev.messageID === group.messageID &&
        prev.partIds === group.partIds &&
        prev.typing === typing
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
      };
      rowCache.set(v.index, row);
      out.push(row);
    }
    return out;
  });

  // History fetch: re-runs on session/server change and on retry. A version
  // counter rejects stale responses so fast session switches can't apply
  // the wrong history. The fetch only upserts, so it never clobbers parts
  // that a live SSE stream already delivered (M2-09).
  createEffect(() => {
    const serverId = props.serverId;
    const sessionId = props.sessionId;
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
        const service = createMessageService(getApiClient());
        const history = await service.list(sessionId, { dir: getActiveDirectory() });
        if (cancelled || version !== fetchVersion) return;
        // The service returns { info, parts } pairs: record the message info
        // and normalize its parts so the store's part order matches history.
        // Applied in ONE store pass (M2-09) instead of one produce per item.
        const items: MessageBatchItem[] = [];
        for (const item of history) {
          items.push({ type: "message", info: item.info });
          for (const part of item.parts) items.push({ type: "part", part });
        }
        applyMessageBatch(serverId, sessionId, items);
        if (version === fetchVersion) setLoading(false);
      } catch (err) {
        if (cancelled || version !== fetchVersion) return;
        setError(ApiError.fromUnknown(err));
        setLoading(false);
      }
    })();
  });

  // Auto-scroll: while the user is not paused, pin the bottom whenever the
  // transcript grows (new groups) or a streamed delta lands; while paused,
  // either one flags the jump button. The lastDeltaAt subscription fires
  // per delta at O(1) — no part scanning.
  createEffect(() => {
    const count = groups().length;
    const stamp = messages[props.serverId]?.[props.sessionId]?.lastDeltaAt ?? 0;
    if (count > lastGroupCount || stamp !== lastDeltaStamp) {
      if (paused()) setHasNew(true);
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
                        ref={(el) => list.measureRow(row.index, el)}
                        data-virtual-row={row.index}
                        class={`absolute left-0 right-0 px-4 pb-4 ${row.index === 0 ? "pt-4" : ""}`}
                        style={{ top: `${row.start}px` }}
                      >
                        <MessageBubble
                          serverId={props.serverId}
                          sessionId={props.sessionId}
                          messageID={row.messageID}
                          partIds={row.partIds}
                          typing={row.typing}
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
