// Session list (TASK-M2-04/05, TASK-M6-03/07): the sidebar's lower section.
// Renders the server's sessions as a PARENT-CHILD TREE (M6-07): parents show
// a chevron, children indent below them with a left connector border, and
// collapsed subtrees hide; the rows group by local time (Today / Yesterday /
// This Week / Earlier) partitioning the tree roots only. Each row has a
// status badge (busy spinner, idle dot, error red dot), a fork badge for
// children, a shared badge, a local search filter, the active-session
// highlight, a per-row actions menu (rename / delete dialogs) and a
// "+ New session" button (header + empty state). The store is SSE-driven,
// so grouping, badges and the tree update live without polling; re-expanding
// a parent asks GET /session/{id}/children once so subagent sessions not yet
// in the store join the tree.
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
  upsertSession,
} from "../../stores/session.js";
import { formatRelativeTime } from "../servers/relativeTime.js";
import { groupSessionsByTime, type SessionTimeGroup } from "./timeGroups.js";
import { buildSessionTree, topLevelRoots, type SessionTreeNode } from "./sessionTree.js";
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
  /** Tree depth of this row (0 = a top-level root). */
  depth: number;
  /** Whether the session has children in the store (chevron shows). */
  hasChildren: boolean;
  /** Whether the children are currently visible. */
  expanded: boolean;
  /** Toggles expand/collapse of this node's subtree. */
  onToggle: () => void;
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
  // Tree mode (TASK-M6-07): depth drives the indent, and every nested row
  // carries a left connector border (CSS border, no connector glyphs).
  const indent = () => 12 + props.depth * 14;
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`session-item-${props.session.id}`}
      data-depth={props.depth}
      data-active={props.active ? "true" : "false"}
      data-forked={forked() ? "true" : "false"}
      aria-current={props.active ? "true" : undefined}
      class={`group flex w-full cursor-pointer items-center gap-2 py-2 pr-3 outline-none hover:bg-accent-soft focus:bg-accent-soft ${
        props.depth > 0 ? "border-l border-bg-sunken" : ""
      }`}
      style={{ "padding-left": `${indent()}px` }}
      onClick={() => props.onSelect(props.session.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect(props.session.id);
        }
      }}
    >
      <Show when={props.hasChildren}>
        <button
          type="button"
          data-testid="session-tree-toggle"
          aria-expanded={props.expanded ? "true" : "false"}
          aria-label={props.expanded ? "Collapse" : "Expand"}
          class={`shrink-0 rounded-sm p-0.5 text-xs leading-none text-fg-faint outline-none hover:text-fg-primary focus:text-fg-primary ${
            props.expanded ? "rotate-90" : ""
          }`}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggle();
          }}
        >
          ▸
        </button>
      </Show>
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

/** Renders one tree node: its row (chevron + depth indent + connectors)
 *  plus, while expanded, its children recursively (TASK-M6-07). */
function SessionTreeNodeView(props: {
  node: SessionTreeNode;
  state: ServerSessionState;
  nowMs: number;
  collapsed: ReadonlySet<string>;
  onToggle: (session: Session) => void;
  onSelect: (sessionId: string) => void;
  onRename: (session: Session) => void;
  onDelete: (session: Session) => void;
  onFork: (session: Session) => void;
  onShare: (session: Session) => void;
  onSummarize: (session: Session) => void;
  onInit: (session: Session) => void;
  parentTitleOf: (session: Session) => string | undefined;
}) {
  // Getters (not consts): collapse state and store children change after
  // mount, and the props must track those signals reactively.
  const hasChildren = () => props.node.children.length > 0;
  const expanded = () => hasChildren() && !props.collapsed.has(props.node.session.id);
  return (
    <>
      <SessionRow
        session={props.node.session}
        status={props.state.statuses[props.node.session.id]}
        active={props.state.activeSessionId === props.node.session.id}
        nowMs={props.nowMs}
        depth={props.node.depth}
        hasChildren={hasChildren()}
        expanded={expanded()}
        onToggle={() => props.onToggle(props.node.session)}
        parentTitle={props.parentTitleOf(props.node.session)}
        onSelect={props.onSelect}
        onRename={props.onRename}
        onDelete={props.onDelete}
        onFork={props.onFork}
        onShare={props.onShare}
        onSummarize={props.onSummarize}
        onInit={props.onInit}
      />
      <Show when={expanded()}>
        <For each={props.node.children}>
          {(child) => (
            <SessionTreeNodeView
              node={child}
              state={props.state}
              nowMs={props.nowMs}
              collapsed={props.collapsed}
              onToggle={props.onToggle}
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
      </Show>
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
  // Tree mode (TASK-M6-07): the set of collapsed subtree roots (children
  // stay hidden until the chevron re-expands them), plus the set of parents
  // whose server-side children were already fetched (one-shot completeness).
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set());
  const [childrenFetched, setChildrenFetched] = createSignal<ReadonlySet<string>>(new Set());

  // The store's sessions in render order.
  const storeSessions = createMemo(() => {
    const st = state();
    return st.order.map((id) => st.sessions[id]).filter((s): s is Session => s !== undefined);
  });

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (q === "") return storeSessions();
    return storeSessions().filter((session) => matchesQuery(session, q));
  });

  // Tree mode (TASK-M6-07): roots are the matched sessions with NO
  // transitively matched ancestor — a deep match under a matched grandparent
  // renders inside that subtree instead of duplicating as a standalone root
  // (the TASK-M6-03 carry-over fix, see sessionTree.topLevelRoots). Children
  // are looked up over the whole store, so a matched root pulls its entire
  // subtree along. Time groups partition the roots only; subtrees render
  // directly under their parent regardless of group.
  const roots = createMemo(() => topLevelRoots(filtered(), storeSessions()));
  const tree = createMemo(() => buildSessionTree(storeSessions(), roots()));
  const groups = createMemo(() => groupSessionsByTime(roots(), now()));

  /** Toggles a node's expand state. Re-EXPANDING a parent asks the server's
   *  /children endpoint ONCE and upserts the returned sessions, so the tree
   *  stays complete (subagent sessions that have not arrived via SSE yet
   *  join on expand). Fetch failures are ignored — the store is the truth. */
  function toggleNode(session: Session) {
    const id = session.id;
    const next = new Set(collapsed());
    const nowExpanded = next.has(id);
    if (nowExpanded) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    const fetched = childrenFetched();
    if (nowExpanded && !fetched.has(id)) {
      setChildrenFetched(new Set(fetched).add(id));
      const serverId = props.serverId;
      void createSessionService(getApiClient())
        .children(id)
        .then((children) => {
          for (const child of children ?? []) upsertSession(serverId, child);
        })
        .catch(() => undefined);
    }
  }

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
                <For each={tree().filter((node) => group.sessions.includes(node.session))}>
                  {(node) => (
                    <SessionTreeNodeView
                      node={node}
                      state={state()}
                      nowMs={now()}
                      collapsed={collapsed()}
                      onToggle={toggleNode}
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
