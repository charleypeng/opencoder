// Mobile sessions tab root (TASK-M7-03/06): a thin mobile session list
// over the SSE-fed session store. Rows push the Chat page onto the
// Sessions tab's stack (per-tab push navigation; Chat pops back).
//
// TASK-M7-06 (gestures): rows swipe LEFT to reveal Rename/Delete actions
// — the gesture is direction-locked (vertical drags scroll, horizontal
// drags reveal; release past ~40px commits, below it snaps back, taps on
// a revealed row close it without navigating) and only one row stays
// revealed at a time. The list pulls DOWN at the top to refresh:
// re-fetching the session list + status map into the stores
// (refreshSessionList), with an indicator that follows the pull and a
// spinner that holds while the round-trip is in flight. Rename/Delete
// reuse the desktop dialogs (same sessionActions mutations, same
// confirmation step). The desktop SessionList (tree, search, row actions)
// is sidebar-oriented; the mobile list keeps its own UX.

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import type { Session } from "../../services/session.js";
import type { SessionStatusEntry } from "../../stores/session.js";
import { getServerSessionState, setActiveSession } from "../../stores/session.js";
import { push } from "./navigation.js";
import { PageHeader } from "./PageHeader.js";
import type { MobilePageProps } from "./pages.js";
import { usePullToRefresh, useSwipeActions } from "./gestures.js";
import type { SwipeActions } from "./gestures.js";
import { refreshSessionList } from "./refresh.js";
import RenameSessionDialog from "../../features/sessions/RenameSessionDialog.js";
import DeleteSessionDialog from "../../features/sessions/DeleteSessionDialog.js";
import { useT } from "../../i18n/index.js";

/** Width of the revealed actions strip (two 64px buttons). */
const SWIPE_ACTIONS_WIDTH = 128;

/** Row status glyph: busy/retry spinner, error dot, or the idle dot. */
function statusDotClass(status: SessionStatusEntry | undefined): string {
  if (status?.type === "busy" || status?.type === "retry") {
    return "h-2.5 w-2.5 animate-spin rounded-full border border-accent border-t-transparent";
  }
  if (status?.type === "error") return "h-2 w-2 rounded-full bg-danger";
  return "h-2 w-2 rounded-full bg-fg-faint";
}

/** One swipeable session row: a fixed actions strip (Rename/Delete) behind
 *  a direction-locked, horizontally translated foreground. touch-action:
 *  pan-y keeps native vertical scrolling; horizontal pans belong to the
 *  swipe hook. */
function SessionRow(props: {
  id: string;
  session: () => Session | undefined;
  status: () => SessionStatusEntry | undefined;
  swipe: SwipeActions;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const rowStyle = () => ({
    transform: `translateX(${props.swipe.translateX()}px)`,
    transition: props.swipe.dragging() ? "none" : "transform 0.25s ease-out",
  });
  return (
    <li class="relative overflow-hidden" style={{ "touch-action": "pan-y" }}>
      <div class="absolute inset-y-0 right-0 flex items-stretch">
        <button
          type="button"
          data-testid={`session-swipe-rename-${props.id}`}
          class="w-16 bg-accent text-sm font-medium text-white outline-none active:opacity-80"
          onClick={() => props.onRename()}
        >
          Rename
        </button>
        <button
          type="button"
          data-testid={`session-swipe-delete-${props.id}`}
          class="w-16 bg-danger text-sm font-medium text-white outline-none active:opacity-80"
          onClick={() => props.onDelete()}
        >
          Delete
        </button>
      </div>
      <div {...props.swipe.handlers} class="relative bg-bg-base" style={rowStyle()}>
        <button
          type="button"
          data-testid={`session-row-${props.id}`}
          class="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-bg-sunken"
          onClick={() => props.onOpen()}
        >
          <span aria-hidden="true" class={statusDotClass(props.status())} />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-fg-primary">
              {props.session()?.title || props.session()?.slug}
            </span>
            <span class="block truncate text-xs text-fg-secondary">{props.session()?.slug}</span>
          </span>
        </button>
      </div>
    </li>
  );
}

export const SessionsPage: Component<MobilePageProps> = (props) => {
  const t = useT();
  const state = () => getServerSessionState(props.serverId);
  const [renameTarget, setRenameTarget] = createSignal<Session | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<Session | null>(null);

  // Pull-to-refresh: re-fetch the session list + statuses; failures are
  // silent (the next pull retries), the spinner holds until it settles.
  const ptr = usePullToRefresh({
    onRefresh: async () => {
      try {
        await refreshSessionList(props.serverId);
      } catch {
        // Pull-to-refresh failures are silent; the next pull retries.
      }
    },
  });

  // One revealed row at a time: each row reports its own reveal (it was
  // opened most recently, so it wins), and the effect closes every OTHER
  // revealed row.
  const swipes = new Map<string, SwipeActions>();
  onCleanup(() => swipes.clear());
  const [openId, setOpenId] = createSignal<string | null>(null);
  createEffect(() => {
    const current = openId();
    if (current === null) return;
    for (const [id, swipe] of swipes) {
      if (id !== current && swipe.revealed()) swipe.close();
    }
  });

  const indicatorStyle = () => ({
    height: `${ptr.pull()}px`,
    transition: ptr.dragging() ? "none" : "height 0.2s ease-out",
  });

  return (
    <div class="flex h-full flex-col" data-testid="mobile-page-sessions-root">
      <PageHeader
        title={t("mobile:sessions")}
        onBack={props.onExit}
        backLabel={t("mobile:servers")}
      />
      <div
        ref={ptr.containerRef}
        data-testid="mobile-sessions-scroll"
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div
          data-testid="pull-indicator"
          aria-hidden="true"
          class="flex items-end justify-center overflow-hidden"
          style={indicatorStyle()}
        >
          <Show
            when={ptr.refreshing()}
            fallback={
              <span data-testid="pull-hint" class="pb-1 text-xs text-fg-faint">
                ↓
              </span>
            }
          >
            <span
              data-testid="pull-spinner"
              class="mb-1 inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent"
            />
          </Show>
        </div>
        <Show
          when={state().order.length > 0}
          fallback={
            <p data-testid="sessions-empty" class="p-4 text-sm text-fg-secondary">
              No sessions yet
            </p>
          }
        >
          <ul class="divide-y divide-bg-sunken">
            <For each={state().order}>
              {(id) => {
                const session = () => state().sessions[id];
                const status = () => state().statuses[id];
                const swipe = useSwipeActions({ revealWidth: SWIPE_ACTIONS_WIDTH });
                swipes.set(id, swipe);
                onCleanup(() => swipes.delete(id));
                // A row that opens becomes the current one (most recent
                // wins over any other open row).
                createEffect(() => {
                  if (swipe.revealed()) setOpenId(id);
                });
                return (
                  <SessionRow
                    id={id}
                    session={session}
                    status={status}
                    swipe={swipe}
                    onOpen={() => {
                      setActiveSession(props.serverId, id);
                      push({ page: "chat", params: { sessionId: id } });
                    }}
                    onRename={() => {
                      swipe.close();
                      setRenameTarget(session() ?? null);
                    }}
                    onDelete={() => {
                      swipe.close();
                      setDeleteTarget(session() ?? null);
                    }}
                  />
                );
              }}
            </For>
          </ul>
        </Show>
      </div>
      <Show when={renameTarget()} keyed>
        {(target) => (
          <RenameSessionDialog
            serverId={props.serverId}
            session={target}
            onClose={() => setRenameTarget(null)}
          />
        )}
      </Show>
      <Show when={deleteTarget()} keyed>
        {(target) => (
          <DeleteSessionDialog
            serverId={props.serverId}
            session={target}
            onClose={() => setDeleteTarget(null)}
          />
        )}
      </Show>
    </div>
  );
};
