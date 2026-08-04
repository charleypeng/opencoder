// Mobile chat page (TASK-M7-03/06): pushed from the Sessions list. Reuses
// the desktop MessageList for the transcript — it renders from the SSE-fed
// stores, so it works unchanged on mobile; the mobile composer and
// message actions land with later M7 tasks (sheets M7-05, gestures M7-06).
// "View diff" pushes the Diff placeholder to prove the push stack beyond
// one level (list -> chat -> diff). TASK-M7-06: a right-swipe from the
// left edge (~24px zone, ~40px commit) pops the page (the header Back
// remains the explicit path), and the transcript is marked `mobile` so
// message bubbles gain the long-press action menu.

import { Show } from "solid-js";
import type { Component } from "solid-js";
import MessageList from "../../features/messages/MessageList.js";
import { getServerSessionState } from "../../stores/session.js";
import { back, push } from "./navigation.js";
import { PageHeader } from "./PageHeader.js";
import { useEdgeSwipeBack } from "./gestures.js";
import type { MobilePageProps } from "./pages.js";

export const ChatPage: Component<MobilePageProps> = (props) => {
  const sessionId = () => props.route.params?.sessionId ?? null;
  const session = () => {
    const id = sessionId();
    return id === null ? undefined : getServerSessionState(props.serverId).sessions[id];
  };
  const title = () => session()?.title || session()?.slug || "Chat";
  // Edge swipe-back on the whole page: the zone check uses the pointer's
  // own clientX, so a pointerdown on any child bubbles in and is evaluated.
  const edge = useEdgeSwipeBack(() => back());
  return (
    <div class="page-enter-zoom flex h-full flex-col" data-testid="mobile-page-chat" {...edge}>
      <PageHeader title={title()} onBack={() => back()} />
      <Show
        when={sessionId()}
        fallback={
          <p data-testid="chat-no-session" class="p-4 text-sm text-fg-secondary">
            No session
          </p>
        }
      >
        <div class="min-h-0 flex-1">
          <MessageList
            serverId={props.serverId}
            sessionId={sessionId() as string}
            mobile
            onViewDiff={(messageID) =>
              push({
                page: "diff",
                params: { sessionId: sessionId() as string, messageID },
              })
            }
          />
        </div>
      </Show>
    </div>
  );
};
