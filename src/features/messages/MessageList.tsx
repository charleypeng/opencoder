// Message history list (TASK-M2-06): the main pane's chat transcript for
// one session. On mount (and whenever the session changes) the history is
// fetched from GET /session/{id}/message and merged into the normalized
// messages store; live SSE updates keep applying on top afterwards (the
// fetch only upserts, so nothing is ever dropped). Messages are rendered as
// part runs grouped by message id (store order), with user bubbles
// right-aligned and accent-tinted and assistant bubbles left-aligned.
// Text / Reasoning / Tool parts render through their part components;
// other part types are skipped until their features land (M3/M4/M6).
//
// Auto-scroll: new content pins the bottom of the list while the user is
// near it; scrolling up pauses the follow and a "New messages" button
// jumps back to the bottom and resumes.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component, JSX } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createMessageService } from "../../services/message.js";
import { getActiveDirectory } from "../../stores/project.js";
import { applyPartDelta, messages, upsertMessage } from "../../stores/messages.js";
import type { Message, Part } from "../../stores/messages.js";
import ReasoningPart from "./parts/ReasoningPart.js";
import TextPart from "./parts/TextPart.js";
import ToolPart from "./parts/ToolPart.js";

export interface MessageListProps {
  /** The server whose session is shown. */
  serverId: string;
  /** The session to render. */
  sessionId: string;
}

interface MessageGroup {
  messageID: string;
  parts: Part[];
}

type RenderablePart = Extract<Part, { type: "text" } | { type: "reasoning" } | { type: "tool" }>;

function isRenderable(part: Part): part is RenderablePart {
  return part.type === "text" || part.type === "reasoning" || part.type === "tool";
}

/** Groups consecutive parts by message id, preserving first-appearance order. */
function groupParts(order: string[], parts: Record<string, Part>): MessageGroup[] {
  const groups: MessageGroup[] = [];
  const byMessage = new Map<string, MessageGroup>();
  for (const id of order) {
    const part = parts[id];
    if (part === undefined) continue;
    let group = byMessage.get(part.messageID);
    if (group === undefined) {
      group = { messageID: part.messageID, parts: [] };
      byMessage.set(part.messageID, group);
      groups.push(group);
    }
    group.parts.push(part);
  }
  return groups;
}

/** Local hh:mm timestamp for a message's created time. */
function formatMessageTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Pins the bottom of the scroll container; falls back for no-scrollTo DOMs. */
function scrollToBottom(el: HTMLElement, behavior: ScrollBehavior): void {
  // No layout yet (initial mount, jsdom): nothing to pin.
  if (el.scrollHeight === 0) return;
  try {
    el.scrollTo({ top: el.scrollHeight, behavior });
  } catch {
    el.scrollTop = el.scrollHeight;
  }
}

function PartView(props: { part: Part }) {
  // Memoized dispatch so the type switch stays inside a tracked scope; a
  // part's type is immutable for a given identity.
  const view = createMemo<JSX.Element>(() => {
    switch (props.part.type) {
      case "text":
        return <TextPart part={props.part} />;
      case "reasoning":
        return <ReasoningPart part={props.part} />;
      case "tool":
        return <ToolPart part={props.part} />;
      default:
        // Unsupported part types render nothing until their milestones land.
        return null;
    }
  });
  return <>{view()}</>;
}

function MessageBubble(props: { group: MessageGroup; info: Message | undefined }) {
  // Streamed messages may arrive (as part stubs) before their message.updated
  // info; assistant is the safe fallback for an in-flight generation.
  const role = () => props.info?.role ?? "assistant";
  const user = () => role() === "user";
  const created = () => props.info?.time.created;
  const parts = () => props.group.parts.filter(isRenderable);

  return (
    <Show when={parts().length > 0}>
      <div
        data-testid={`message-${props.group.messageID}`}
        data-role={role()}
        class={`flex flex-col gap-1 ${user() ? "items-end" : "items-start"}`}
      >
        <div
          class={`max-w-[78%] rounded-lg px-3 py-2 ${
            user()
              ? "rounded-br-sm bg-accent-soft"
              : "rounded-bl-sm border border-bg-sunken bg-bg-elevated"
          }`}
        >
          <For each={parts()}>{(part) => <PartView part={part} />}</For>
        </div>
        <Show when={created() !== undefined}>
          <span data-testid="message-time" class="px-1 text-xs text-fg-faint">
            {formatMessageTime(created() as number)}
          </span>
        </Show>
      </div>
    </Show>
  );
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
  let lastPartCount = 0;

  const entry = createMemo(() => messages[props.serverId]?.[props.sessionId]);

  const groups = createMemo(() => {
    const current = entry();
    return current === undefined ? [] : groupParts(current.order, current.parts);
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
        for (const item of history) {
          upsertMessage(serverId, sessionId, item.info);
          for (const part of item.parts) applyPartDelta(serverId, sessionId, part);
        }
        if (version === fetchVersion) setLoading(false);
      } catch (err) {
        if (cancelled || version !== fetchVersion) return;
        setError(ApiError.fromUnknown(err));
        setLoading(false);
      }
    })();
  });

  // Auto-scroll: after every store change, follow the bottom while the user
  // is not paused; while paused, flag new content so the jump button shows.
  createEffect(() => {
    const count = entry()?.order.length ?? 0;
    const el = scrollRef;
    if (count > lastPartCount && paused()) setHasNew(true);
    lastPartCount = count;
    if (el !== undefined && !paused()) scrollToBottom(el, "auto");
  });

  function handleScroll(event: Event) {
    const el = event.currentTarget as HTMLDivElement;
    if (Date.now() < suppressUntil) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
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
    scrollToBottom(el, "smooth");
  }

  return (
    <div data-testid="message-list" class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        data-testid="message-list-scroll"
        class="min-h-0 flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        <div class="flex flex-col gap-4 px-4 py-4">
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
                  <For each={groups()}>
                    {(group) => (
                      <MessageBubble group={group} info={entry()?.infos[group.messageID]} />
                    )}
                  </For>
                </Show>
              }
            >
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
            </Show>
          </Show>
        </div>
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
