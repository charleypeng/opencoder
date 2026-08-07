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
// Row menu (TASK-M8-03): the "⋯" button and the row right-click both open
// ONE shared ContextMenu (Fork / Share / Move to server placeholder submenu
// / Compress context / Generate AGENTS.md / Rename / Delete) — the dialogs
// live in SessionList, keyed per target session. The Menu key opens the same
// menu from a focused row through the browser's contextmenu event.
//
// Virtual scroll preparation: rows render plainly today; when session
// counts grow, swap the <For> bodies for a virtualized list (e.g.
// @tanstack/virtual) keeping the same group headers (M2-09).

import { createMemo, createSignal, For, Show } from "solid-js";
import type { Component } from "solid-js";
import ContextMenu from "../../components/ContextMenu.js";
import { useT } from "../../i18n/index.js";
import type { MenuItem } from "../../components/ContextMenu.js";
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
  /** Opens the row's ContextMenu at a position (⋯ button or right-click). */
  onMenu: (session: Session, position: { x: number; y: number }) => void;
}) {
  const t = useT();
  const forked = () => props.session.parentID !== undefined;
  // Shared state derives from the contract's Session.share marker
  // (TASK-M6-05), like the fork badge derives from parentID.
  const shared = () => props.session.share !== undefined;
  // Tree mode (TASK-M6-07): depth drives the indent, and every nested row
  // carries a left connector border (CSS border, no connector glyphs).
  const indent = () => 12 + props.depth * 14;
  return (
    /* TASK-M9-08: the row wrapper is NON-interactive (it only forwards
       clicks/keys) so the row's focusable <button> and the tree-toggle /
       actions buttons stay siblings — interactive controls nested inside
       the row button violated axe nested-interactive. */
    <div
      data-testid={`session-item-${props.session.id}`}
      data-depth={props.depth}
      data-active={props.active ? "true" : "false"}
      data-forked={forked() ? "true" : "false"}
      class={`group relative flex w-full cursor-pointer items-center gap-2 py-1.5 pr-3 transition-colors ${
        props.active ? "bg-accent-soft" : "hover:bg-bg-sunken/50"
      } ${props.depth > 0 ? "border-l border-bg-sunken" : ""}`}
      style={{ "padding-left": `${indent()}px` }}
      onClick={() => props.onSelect(props.session.id)}
      onKeyDown={(event) => {
        // Keyboard events on the row button itself reach the wrapper as a
        // native click; only direct key events (test/AT-triggered on the
        // wrapper) select here.
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect(props.session.id);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onMenu(props.session, { x: event.clientX, y: event.clientY });
      }}
    >
      <Show when={props.hasChildren}>
        <button
          type="button"
          data-testid="session-tree-toggle"
          aria-expanded={props.expanded ? "true" : "false"}
          aria-label={props.expanded ? t("sessions:collapse") : t("sessions:expand")}
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
      <button
        type="button"
        aria-current={props.active ? "true" : undefined}
        aria-haspopup="menu"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 pr-8 text-left focus:bg-accent-soft"
      >
        <Show when={forked()}>
          <span
            data-testid="session-fork-badge"
            title={
              props.parentTitle !== undefined
                ? t("sessions:forkedFrom", { title: props.parentTitle })
                : t("sessions:forkBadge")
            }
            class="shrink-0 rounded-full border border-accent bg-accent-soft px-1.5 py-px text-[10px] leading-tight text-accent"
          >
            {t("sessions:forkBadge")}
          </span>
        </Show>
        <Show when={shared()}>
          <span
            data-testid="session-shared-badge"
            title={t("sessions:sharedHint")}
            class="shrink-0 rounded-full border border-accent bg-accent-soft px-1.5 py-px text-[10px] leading-tight text-accent"
          >
            {t("sessions:sharedBadge")}
          </span>
        </Show>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm">{titleOf(props.session)}</span>
          <span class="block truncate font-code text-xs text-fg-secondary">
            {formatRelativeTime(props.session.time.updated, props.nowMs)}
          </span>
        </span>
        <StatusBadge status={props.status} />
      </button>
      {/* The ⋯ trigger (TASK-M8-03): opens the shared ContextMenu below the
          button; the row right-click opens the same menu at the cursor. */}
      <button
        type="button"
        data-testid="session-row-menu"
        aria-label={t("sessions:sessionActions")}
        class="invisible absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-1.5 text-sm leading-none text-fg-secondary outline-none transition-opacity group-hover:visible group-hover:opacity-100 focus:visible focus:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          props.onMenu(props.session, { x: rect.left, y: rect.bottom });
        }}
      >
        ⋯
      </button>
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
  onMenu: (session: Session, position: { x: number; y: number }) => void;
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
        onMenu={props.onMenu}
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
              onMenu={props.onMenu}
              parentTitleOf={props.parentTitleOf}
            />
          )}
        </For>
      </Show>
    </>
  );
}

const SessionList: Component<SessionListProps> = (props) => {
  const t = useT();
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
  // Row ContextMenu target (TASK-M8-03): the session plus the request
  // position (⋯ button / right-click / Menu key on a focused row).
  const [rowMenu, setRowMenu] = createSignal<{ session: Session; x: number; y: number } | null>(
    null,
  );
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

  /** Toggles a node's expand state. Expanding a node that WAS collapsed
   *  (wasCollapsed) asks the server's /children endpoint ONCE and upserts
   *  the returned sessions, so the tree stays complete (subagent sessions
   *  that have not arrived via SSE yet join on expand). Fetch failures are
   *  ignored — the store is the truth. */
  function toggleNode(session: Session) {
    const id = session.id;
    const next = new Set(collapsed());
    const wasCollapsed = next.has(id);
    if (wasCollapsed) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    const fetched = childrenFetched();
    if (wasCollapsed && !fetched.has(id)) {
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

  /** Row ContextMenu items (TASK-M8-03): §3.2 session actions plus the
   *  M6-03/05/06 items, with the cross-server move as a GRAYED PLACEHOLDER
   *  submenu (the drag-to-server migration is a ui-design §3.2 backlog
   *  item). The dialogs stay keyed per target session in this component. */
  const rowMenuItems = createMemo<MenuItem[]>(() => {
    const target = rowMenu();
    if (target === null) return [];
    const session = target.session;
    return [
      { id: "fork", label: t("sessions:fork"), onSelect: () => handleFork(session) },
      { id: "share", label: t("sessions:share"), onSelect: () => setShareTarget(session) },
      {
        id: "move-server",
        label: t("sessions:moveToServer"),
        submenu: [
          { id: "move-server-unavailable", label: t("sessions:notAvailable"), disabled: true },
        ],
      },
      {
        id: "summarize",
        label: t("sessions:compress"),
        onSelect: () => setSummarizeTarget(session),
      },
      { id: "init", label: t("sessions:generateAgents"), onSelect: () => setInitTarget(session) },
      { separator: true },
      { id: "rename", label: t("sessions:rename"), onSelect: () => setRenameTarget(session) },
      {
        id: "delete",
        label: t("common:delete"),
        danger: true,
        onSelect: () => setDeleteTarget(session),
      },
    ];
  });

  return (
    <div data-testid="session-list" class="flex min-h-0 flex-1 flex-col">
      <div class="px-3 pb-1.5 pt-2">
        <ErrorBanner error={createError()} onDismiss={() => setCreateError(null)} />
        <div class="pt-1.5">
          <ErrorBanner error={forkError()} onDismiss={() => setForkError(null)} />
        </div>
        <button
          type="button"
          data-testid="new-session-button"
          class="mb-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary focus:border-fg-faint disabled:cursor-not-allowed disabled:opacity-50"
          disabled={creating()}
          onClick={handleCreate}
        >
          {creating() ? t("sessions:creating") : `+ ${t("sessions:newSession")}`}
        </button>
        <input
          type="search"
          data-testid="session-search"
          aria-label={t("sessions:search")}
          placeholder={t("sessions:search")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          class="w-full rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1 text-xs outline-none placeholder:text-fg-faint focus:border-fg-faint"
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
                  <p class="text-sm text-fg-secondary">{t("sessions:noMatching")}</p>
                </div>
              }
            >
              <div data-testid="session-empty" class="px-3 py-6 text-center">
                <p class="text-sm text-fg-secondary">{t("sessions:noSessions")}</p>
                <p class="mt-1 text-xs text-fg-faint">{t("sessions:noSessionsHint")}</p>
                <button
                  type="button"
                  data-testid="new-session-empty-button"
                  class="mt-3 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-sm text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary focus:border-fg-faint disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={creating()}
                  onClick={handleCreate}
                >
                  {creating() ? t("sessions:creating") : `+ ${t("sessions:newSession")}`}
                </button>
              </div>
            </Show>
          }
        >
          <For each={groups()}>
            {(group: SessionTimeGroup) => (
              <section aria-label={t(group.labelKey)}>
                <div
                  data-testid={`session-group-${group.key}`}
                  class="sticky top-0 z-10 border-b border-bg-sunken bg-bg-elevated px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-fg-faint"
                >
                  {t(group.labelKey)}
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
                      onMenu={(session, position) => setRowMenu({ session, ...position })}
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

      {/* Row context menu (TASK-M8-03): the ⋯ button and the row
          right-click share one menu; keyboard (Menu key) works via the
          focused row's contextmenu event. */}
      <Show when={rowMenu() !== null}>
        <ContextMenu
          testId="session-menu"
          label={t("sessions:sessionActions")}
          x={rowMenu()!.x}
          y={rowMenu()!.y}
          items={rowMenuItems()}
          onClose={() => setRowMenu(null)}
        />
      </Show>
    </div>
  );
};

export default SessionList;
