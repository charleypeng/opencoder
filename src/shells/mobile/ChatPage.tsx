// Mobile chat page (TASK-M7-03): pushed from the Sessions list. Reuses the
// desktop MessageList for the transcript — it renders from the SSE-fed
// stores, so it works unchanged on mobile; the mobile composer and
// message actions land with later M7 tasks (sheets M7-05, gestures M7-06).
// "View diff" pushes the Diff placeholder to prove the push stack beyond
// one level (list -> chat -> diff).

import { Show } from "solid-js";
import type { Component } from "solid-js";
import MessageList from "../../features/messages/MessageList.js";
import { getServerSessionState } from "../../stores/session.js";
import { back, push } from "./navigation.js";
import { PageHeader } from "./PageHeader.js";
import type { MobilePageProps } from "./pages.js";

export const ChatPage: Component<MobilePageProps> = (props) => {
  const sessionId = () => props.route.params?.sessionId ?? null;
  const session = () => {
    const id = sessionId();
    return id === null ? undefined : getServerSessionState(props.serverId).sessions[id];
  };
  const title = () => session()?.title || session()?.slug || "Chat";
  return (
    <div class="flex h-full flex-col" data-testid="mobile-page-chat">
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
