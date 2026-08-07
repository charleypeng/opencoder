// Mobile chat page (TASK-M7-03/06/REDESIGN): pushed from the Sessions list.
// Reuses the desktop MessageList for the transcript (renders from SSE-fed
// stores, works unchanged on mobile; `mobile` prop enables the long-press
// action menu on message bubbles).
//
// REDESIGN (docs/chat-redesign-spec §3.9, docs/ui-design §4/§5):
// - Glass-morphism composer pinned to the bottom, above the safe-area inset,
//   with interactive-widget=resizes-content keeping it visible above the
//   on-screen keyboard (viewport meta tag already sets this).
// - Touch targets ≥ 44px (iOS HIG) on all interactive controls.
// - prefers-reduced-motion: all transition/animation durations collapse to 0
//   via --dur-* tokens; the composer fade-in respects that.
// - Glass styling uses the .glass class (tier B, ui-design §5) which is
//   already defined in tokens.css with the performance guard (≤4 backdrop-
//   filter elements on screen).
// - Right-swipe-back (useEdgeSwipeBack) from the left edge is preserved.
// - Page-enter-zoom transition on mount (shared-element simplification).

import { Show } from "solid-js";
import type { Component } from "solid-js";
import MessageList from "../../features/messages/MessageList.js";
import PromptBox from "../../features/sessions/PromptBox.js";
import { getServerSessionState } from "../../stores/session.js";
import { back, push } from "./navigation.js";
import { PageHeader } from "./PageHeader.js";
import { useEdgeSwipeBack } from "./gestures.js";
import type { MobilePageProps } from "./pages.js";
import { useT } from "../../i18n/index.js";

/** Glass-styled mobile composer pinned at the bottom of the chat page.
 *  Wraps the shared PromptBox (which owns all send/history/attachment logic)
 *  with safe-area padding, touch-target sizing, and the tier-B glass border.
 *  The wrapper is the sole consumer of `env(safe-area-inset-bottom)` so the
 *  message list can scroll freely without fighting the inset. */
const MobileComposer: Component<{ serverId: string; sessionId: string }> = (props) => (
  <div
    data-testid="mobile-chat-composer"
    class="glass flex shrink-0 flex-col border-t px-2 pb-safe"
    style={{ "border-color": "var(--glass-border)" }}
  >
    <PromptBox serverId={props.serverId} sessionId={props.sessionId} />
  </div>
);

export const ChatPage: Component<MobilePageProps> = (props) => {
  const t = useT();
  const sessionId = () => props.route.params?.sessionId ?? null;
  const session = () => {
    const id = sessionId();
    return id === null ? undefined : getServerSessionState(props.serverId).sessions[id];
  };
  const title = () => session()?.title || session()?.slug || t("mobile:chat");
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
            {t("mobile:noSession")}
          </p>
        }
      >
        {/* Message list fills remaining space; min-h-0 lets it shrink
            inside the flex column so the composer can claim its height. */}
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
        {/* Glass composer: sticks to the bottom above the safe-area inset.
            interactive-widget=resizes-content (index.html) causes the
            browser to shrink the dvh when the keyboard opens, keeping this
            element visible above the keyboard without manual resize logic. */}
        <MobileComposer serverId={props.serverId} sessionId={sessionId() as string} />
      </Show>
    </div>
  );
};
