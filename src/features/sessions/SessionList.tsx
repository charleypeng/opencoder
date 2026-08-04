// Session list (TASK-M2-04/05): the sidebar's lower section. Renders the
// server's sessions grouped by local time (Today / Yesterday / This Week /
// Earlier) with a status badge per session (busy spinner, idle dot, error
// red dot), a local search filter, the active-session highlight, a
// per-row actions menu (rename / delete dialogs) and a "+ New session"
// button (header + empty state). The store is SSE-driven, so grouping and
// badges update live without polling.
//
// Virtual scroll preparation: rows render plainly today; when session
// counts grow, swap the <For> bodies for a virtualized list (e.g.
// @tanstack/virtual) keeping the same group headers (M2-09).

import { createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { DropdownMenu } from "@kobalte/core";
import ErrorBanner from "../../components/ErrorBanner.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import type { Session } from "../../services/session.js";
import { createSessionService } from "../../services/session.js";
import {
  type ServerSessionState,
  type SessionStatusEntry,
  getServerSessionState,
  setActiveSession,
} from "../../stores/session.js";
import { formatRelativeTime } from "../servers/relativeTime.js";
import { groupSessionsByTime, type SessionTimeGroup } from "./timeGroups.js";
import { createSession, forkSession } from "./sessionActions.js";
import DeleteSessionDialog from "./DeleteSessionDialog.js";
import RenameSessionDialog from "./RenameSessionDialog.js";
import ShareSessionDialog from "./ShareSessionDialog.js";
import SummarizeDialog from "./SummarizeDialog.js";
import InitDialog from "./InitDialog.js";

export interface SessionListProps {
  /** The server whose sessions are shown. */
  serverId: string;
  /** Called when a session row is selected (chat view lands in M2-06/08). */
  onSelect: (sessionId: string) => void;
  /** Clock override for tests; defaults to the real wall clock. */
  nowMs?: number;
}

type StatusKind = "busy" | "idle" | "error" | "none";

/** Maps a status entry to a badge kind; retry counts as busy (still active). */
function statusKind(status: SessionStatusEntry | undefined): StatusKind {
  if (status === undefined) return "none";
  if (status.type === "busy" || status.type === "retry") return "busy";
  if (status.type === "idle") return "idle";
  return "error";
}

function badgeClass(kind: StatusKind): string {
  switch (kind) {
    case "busy":
      return "inline-block h-2.5 w-2.5 animate-spin rounded-full border border-accent border-t-transparent";
    case "idle":
      return "inline-block h-2 w-2 rounded-full bg-fg-faint";
    case "error":
      return "inline-block h-2 w-2 rounded-full bg-danger";
    default:
      return "";
  }
}

/** Row title: the server-provided title, falling back to the slug. */
function titleOf(session: Session): string {
  return session.title || session.slug;
}

function matchesQuery(session: Session, query: string): boolean {
  if (query === "") return true;
  return `${titleOf(session)} ${session.slug}`.toLowerCase().includes(query);
}

function StatusBadge(props: { status: SessionStatusEntry | undefined }) {
  const kind = () => statusKind(props.status);
  // Only retry/error entries carry a message (idle/busy do not).
  const message = () =>
    props.status !== undefined && "message" in props.status ? props.status.message : undefined;
  return (
    <Show when={kind() !== "none"}>
      <span
        data-testid="session-status"
        data-status={kind()}
        title={message()}
        class={badgeClass(kind())}
      />
    </Show>
  );
}

// Hover actions (TASK-M2-05 / TASK-M6-03): the "⋯" trigger opens a
// rename/delete/fork menu; the dialogs live in SessionList, keyed per
// target session. TASK-M6-05 adds the Share item (share dialog).
function SessionRowMenu(props: {
  onRename: () => void;
  onDelete: () => void;
  onFork: () => void;
  onShare: () => void;
  onSummarize: () => void;
  onInit: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        as="button"
        type="button"
        data-testid="session-row-menu"
        aria-label="Session actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        class="invisible rounded-md px-1.5 text-sm leading-none text-fg-secondary transition-opacity group-hover:visible group-hover:opacity-100"
      >
        ⋯
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="glass z-50 min-w-36 p-1">
          <DropdownMenu.Item
            data-testid="session-menu-fork"
            class={menuItemClass}
            onSelect={props.onFork}
          >
            Fork
          </DropdownMenu.Item>
          <DropdownMenu.Item
            data-testid="session-menu-share"
            class={menuItemClass}
            onSelect={props.onShare}
          >
            Share
          </DropdownMenu.Item>
          <DropdownMenu.Item
            data-testid="session-menu-summarize"
            class={menuItemClass}
            onSelect={props.onSummarize}
          >
            Compress context
          </DropdownMenu.Item>
          <DropdownMenu.Item
            data-testid="session-menu-init"
            class={menuItemClass}
            onSelect={props.onInit}
          >
            Generate AGENTS.md
          </DropdownMenu.Item>
          <DropdownMenu.Item
            data-testid="session-menu-rename"
            class={menuItemClass}
            onSelect={props.onRename}
          >
            Rename
          </DropdownMenu.Item>
          <DropdownMenu.Item
            data-testid="session-menu-delete"
            class={menuItemClass}
            onSelect={props.onDelete}
          >
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const menuItemClass =
  "flex w-full rounded-sm px-3 py-1.5 text-left text-sm outline-none " +
  "hover:bg-accent-soft focus:bg-accent-soft data-[highlighted]:bg-accent-soft";

function SessionRow(props: {
  session: Session;
  status: SessionStatusEntry | undefined;
  active: boolean;
  nowMs: number;
  /** Parent session title for the fork badge tooltip (TASK-M6-03). */
  parentTitle?: string;
  onSelect: (sessionId: string) => void;
  onRename: (session: Session) => void;
  onDelete: (session: Session) => void;
  onFork: (session: Session) => void;
  onShare: (session: Session) => void;
  onSummarize: (session: Session) => void;
  onInit: (session: Session) => void;
}) {
  const forked = () => props.session.parentID !== undefined;
  // Shared state derives from the contract's Session.share marker
  // (TASK-M6-05), like the fork badge derives from parentID.
  const shared = () => props.session.share !== undefined;
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`session-item-${props.session.id}`}
      data-active={props.active ? "true" : "false"}
      data-forked={forked() ? "true" : "false"}
      aria-current={props.active ? "true" : undefined}
      class={`group flex w-full cursor-pointer items-center gap-2 px-3 py-2 outline-none hover:bg-accent-soft focus:bg-accent-soft ${
        forked() ? "pl-8" : ""
      }`}
      onClick={() => props.onSelect(props.session.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect(props.session.id);
        }
      }}
    >
      <Show when={forked()}>
        <span
          data-testid="session-fork-badge"
          title={props.parentTitle !== undefined ? `Forked from ${props.parentTitle}` : "Forked"}
          class="shrink-0 rounded-full border border-accent bg-accent-soft px-1.5 py-px text-[10px] leading-tight text-accent"
        >
          fork
        </span>
      </Show>
      <Show when={shared()}>
        <span
          data-testid="session-shared-badge"
          title="Shared — anyone with the link can view"
          class="shrink-0 rounded-full border border-accent bg-accent-soft px-1.5 py-px text-[10px] leading-tight text-accent"
        >
          shared
        </span>
      </Show>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm">{titleOf(props.session)}</span>
        <span class="block truncate font-code text-xs text-fg-secondary">
          {formatRelativeTime(props.session.time.updated, props.nowMs)}
        </span>
      </span>
      <StatusBadge status={props.status} />
      <SessionRowMenu
        onRename={() => props.onRename(props.session)}
        onDelete={() => props.onDelete(props.session)}
        onFork={() => props.onFork(props.session)}
        onShare={() => props.onShare(props.session)}
        onSummarize={() => props.onSummarize(props.session)}
        onInit={() => props.onInit(props.session)}
      />
    </div>
  );
}

/** Renders one session row plus its forked children (recursively),
 *  indented below the parent regardless of time group (TASK-M6-03; M6-07
 *  replaces this with the full tree view). */
function SessionNode(props: {
  session: Session;
  childrenOf: ReadonlyMap<string, Session[]>;
  state: ServerSessionState;
  nowMs: number;
  onSelect: (sessionId: string) => void;
  onRename: (session: Session) => void;
  onDelete: (session: Session) => void;
  onFork: (session: Session) => void;
  onShare: (session: Session) => void;
  onSummarize: (session: Session) => void;
  onInit: (session: Session) => void;
  parentTitleOf: (session: Session) => string | undefined;
}) {
  return (
    <>
      <SessionRow
        session={props.session}
        status={props.state.statuses[props.session.id]}
        active={props.state.activeSessionId === props.session.id}
        nowMs={props.nowMs}
        parentTitle={props.parentTitleOf(props.session)}
        onSelect={props.onSelect}
        onRename={props.onRename}
        onDelete={props.onDelete}
        onFork={props.onFork}
        onShare={props.onShare}
        onSummarize={props.onSummarize}
        onInit={props.onInit}
      />
      <For each={props.childrenOf.get(props.session.id) ?? []}>
        {(child) => (
          <SessionNode
            session={child}
            childrenOf={props.childrenOf}
            state={props.state}
            nowMs={props.nowMs}
            onSelect={props.onSelect}
            onRename={props.onRename}
            onDelete={props.onDelete}
            onFork={props.onFork}
            onShare={props.onShare}
            onSummarize={props.onSummarize}
            onInit={props.onInit}
            parentTitleOf={props.parentTitleOf}
          />
        )}
      </For>
    </>
  );
}

const SessionList: Component<SessionListProps> = (props) => {
  const state = createMemo(() => getServerSessionState(props.serverId));
  const now = () => props.nowMs ?? Date.now();
  const [query, setQuery] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [createError, setCreateError] = createSignal<ApiError | null>(null);
  const [forking, setForking] = createSignal(false);
  const [forkError, setForkError] = createSignal<ApiError | null>(null);
  const [renameTarget, setRenameTarget] = createSignal<Session | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<Session | null>(null);
  // Share dialog target (TASK-M6-05): set from the row menu's Share item.
  const [shareTarget, setShareTarget] = createSignal<Session | null>(null);
  // Summarize/init dialog targets (TASK-M6-06): set from the row menu's
  // "Compress context" and "Generate AGENTS.md" items.
  const [summarizeTarget, setSummarizeTarget] = createSignal<Session | null>(null);
  const [initTarget, setInitTarget] = createSignal<Session | null>(null);

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const st = state();
    const result: Session[] = [];
    for (const id of st.order) {
      const session = st.sessions[id];
      if (session !== undefined && matchesQuery(session, q)) result.push(session);
    }
    return result;
  });

  // Fork children (TASK-M6-03): parentID -> child sessions in store order.
  // Built over the whole store (not the filtered set) so a search match on
  // a parent pulls its entire subtree along; a child matching on its own
  // still stands alone as a root (badge included).
  const childrenOf = createMemo(() => {
    const st = state();
    const map = new Map<string, Session[]>();
    for (const id of st.order) {
      const session = st.sessions[id];
      if (session?.parentID === undefined) continue;
      const list = map.get(session.parentID);
      if (list === undefined) map.set(session.parentID, [session]);
      else list.push(session);
    }
    return map;
  });

  // Top-level rows: sessions without a parent, or whose parent was filtered
  // out by the search (the child then stands on its own, badge included).
  const roots = createMemo(() => {
    const ids = new Set(filtered().map((s) => s.id));
    return filtered().filter((s) => s.parentID === undefined || !ids.has(s.parentID));
  });

  const groups = createMemo(() => groupSessionsByTime(roots(), now()));

  function select(sessionId: string) {
    setActiveSession(props.serverId, sessionId);
    props.onSelect(sessionId);
  }

  async function handleCreate() {
    if (creating()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createSession(props.serverId, createSessionService(getApiClient()));
    } catch (err) {
      setCreateError(ApiError.fromUnknown(err));
    } finally {
      setCreating(false);
    }
  }

  // Fork (TASK-M6-03): session-level fork (no message point); the child
  // enters the store and opens, a failure surfaces in the list banner.
  async function handleFork(session: Session) {
    if (forking()) return;
    setForking(true);
    setForkError(null);
    try {
      await forkSession(
        props.serverId,
        session.id,
        undefined,
        createSessionService(getApiClient()),
      );
    } catch (err) {
      setForkError(ApiError.fromUnknown(err));
    } finally {
      setForking(false);
    }
  }

  /** Parent title of a forked session (for the badge tooltip), if present. */
  function parentTitleOf(session: Session): string | undefined {
    if (session.parentID === undefined) return undefined;
    const parent = state().sessions[session.parentID];
    return parent === undefined ? undefined : titleOf(parent);
  }

  return (
    <div data-testid="session-list" class="flex min-h-0 flex-1 flex-col">
      <div class="px-3 pb-2 pt-3">
        <ErrorBanner error={createError()} onDismiss={() => setCreateError(null)} />
        <div class="pt-2">
          <ErrorBanner error={forkError()} onDismiss={() => setForkError(null)} />
        </div>
        <button
          type="button"
          data-testid="new-session-button"
          class="mb-2 flex w-full items-center justify-center gap-1 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-sm text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary focus:border-fg-faint disabled:cursor-not-allowed disabled:opacity-50"
          disabled={creating()}
          onClick={handleCreate}
        >
          {creating() ? "Creating…" : "+ New session"}
        </button>
        <input
          type="search"
          data-testid="session-search"
          aria-label="Search sessions"
          placeholder="Search sessions"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          class="w-full rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-sm outline-none placeholder:text-fg-faint focus:border-fg-faint"
        />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto pb-3">
        <Show
          when={groups().length > 0}
          fallback={
            <Show
              when={state().order.length === 0}
              fallback={
                <div data-testid="session-empty-filter" class="px-3 py-6 text-center">
                  <p class="text-sm text-fg-secondary">No matching sessions</p>
                </div>
              }
            >
              <div data-testid="session-empty" class="px-3 py-6 text-center">
                <p class="text-sm text-fg-secondary">No sessions yet</p>
                <p class="mt-1 text-xs text-fg-faint">New conversations appear here.</p>
                <button
                  type="button"
                  data-testid="new-session-empty-button"
                  class="mt-3 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-sm text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary focus:border-fg-faint disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={creating()}
                  onClick={handleCreate}
                >
                  {creating() ? "Creating…" : "+ New session"}
                </button>
              </div>
            </Show>
          }
        >
          <For each={groups()}>
            {(group: SessionTimeGroup) => (
              <section aria-label={group.label}>
                <div
                  data-testid={`session-group-${group.key}`}
                  class="sticky top-0 z-10 border-b border-bg-sunken bg-bg-elevated px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-fg-faint"
                >
                  {group.label}
                </div>
                <For each={group.sessions}>
                  {(session) => (
                    <SessionNode
                      session={session}
                      childrenOf={childrenOf()}
                      state={state()}
                      nowMs={now()}
                      onSelect={select}
                      onRename={setRenameTarget}
                      onDelete={setDeleteTarget}
                      onFork={handleFork}
                      onShare={setShareTarget}
                      onSummarize={setSummarizeTarget}
                      onInit={setInitTarget}
                      parentTitleOf={parentTitleOf}
                    />
                  )}
                </For>
              </section>
            )}
          </For>
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
      <Show when={shareTarget()} keyed>
        {(target) => (
          <ShareSessionDialog
            serverId={props.serverId}
            session={target}
            onClose={() => setShareTarget(null)}
          />
        )}
      </Show>
      <Show when={summarizeTarget()} keyed>
        {(target) => (
          <SummarizeDialog
            serverId={props.serverId}
            session={target}
            onClose={() => setSummarizeTarget(null)}
          />
        )}
      </Show>
      <Show when={initTarget()} keyed>
        {(target) => (
          <InitDialog
            serverId={props.serverId}
            session={target}
            onClose={() => setInitTarget(null)}
          />
        )}
      </Show>
    </div>
  );
};

export default SessionList;
