// Workspace tree (sidebar nav redesign): the sidebar's main navigation —
// workspace (server) → folder (working directory) → sessions. Renders every
// known directory as a collapsible folder with its ROOT sessions (subagent
// children live in the per-session subtask panel, never here). Data comes
// from GET /session?roots=true (all directories) + GET /project (folder
// names/empty folders); the global session store's live entries (current
// directory, SSE-driven) are merged in so the active folder stays fresh
// without extra requests. Folder rows offer hover actions — Open folder
// (DirectoryPickerDialog positioned at the directory) and Remove from list
// (client-side hide, persisted) — and session rows keep the existing
// ⋯ context menu plus an "Open folder" item.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import type { Component } from "solid-js";
import { createStore, produce } from "solid-js/store";
import ContextMenu from "../../components/ContextMenu.js";
import type { MenuItem } from "../../components/ContextMenu.js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { useT } from "../../i18n/index.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createProjectService, type Project } from "../../services/project.js";
import { createSessionService, type Session } from "../../services/session.js";
import { applyProjects, getServerProjectState, setCurrent } from "../../stores/project.js";
import {
  getServerSessionState,
  sessions as sessionStore,
  setActiveSession,
  type SessionStatusEntry,
} from "../../stores/session.js";
import { formatRelativeTime } from "../servers/relativeTime.js";
import { readDefaultWorkspace } from "../servers/defaultWorkspace.js";
import { pushRecentProject } from "./recentProjects.js";
import { createSession, ensureSessionInDirectory, forkSession } from "./sessionActions.js";
import { basename, buildWorkspaceTree, type WorkspaceFolder } from "./workspaceTreeUtils.js";
import {
  addWorkspace,
  readWorkspaces,
  removeWorkspace as dropWorkspace,
  WORKSPACE_STORAGE_EVENT,
} from "./workspaces.js";
import DirectoryPickerDialog from "./DirectoryPickerDialog.js";
import DeleteSessionDialog from "./DeleteSessionDialog.js";
import RenameSessionDialog from "./RenameSessionDialog.js";
import ShareSessionDialog from "./ShareSessionDialog.js";
import SummarizeDialog from "./SummarizeDialog.js";
import InitDialog from "./InitDialog.js";

export interface WorkspaceTreeProps {
  /** The server whose workspace tree is shown. */
  serverId: string;
  /** Called when a session row is selected. */
  onSelectSession: (sessionId: string) => void;
  /** Called by the folder ⋯ menu's "View folder": switch the main pane to
   *  that directory's files (DesktopShell sets the context + Files view). */
  onViewFolder: (directory: string) => void;
}

/** localStorage keys for the folder expand/hide persistence. */
const COLLAPSED_KEY = "oc-workspace-folders-collapsed";
const HIDDEN_KEY = "oc-workspace-hidden-folders";

function readStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((s): s is string => typeof s === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeStringSet(key: string, set: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // Storage unavailable (private mode): collapse state just won't persist.
  }
}

type StatusKind = "busy" | "error" | "none";

/** A folder shows a live status dot only for the ACTIVE directory (its
 *  statuses are SSE-driven); other folders' statuses are unknown at rest. */
function folderStatusKind(
  folder: WorkspaceFolder,
  isCurrent: boolean,
  statuses: Record<string, SessionStatusEntry>,
): StatusKind {
  if (!isCurrent) return "none";
  for (const session of folder.sessions) {
    const status = statuses[session.id];
    if (status === undefined) continue;
    if (status.type === "busy" || status.type === "retry") return "busy";
    if (status.type === "error") return "error";
  }
  return "none";
}

function statusDotClass(kind: StatusKind): string {
  switch (kind) {
    case "busy":
      return "h-2.5 w-2.5 animate-spin rounded-full border border-accent border-t-transparent";
    case "error":
      return "h-2 w-2 rounded-full bg-danger";
    default:
      return "";
  }
}

/** A folder row: chevron + folder icon + name + count + status dot, with
 *  hover actions (new session here / ⋯ menu) and a "Default" badge when it
 *  is the server's default workspace. Clicking the row (or chevron) only
 *  toggles expand/collapse — entering a directory is the session click or
 *  the ⋯ menu's "View folder". */
function FolderRow(props: {
  folder: WorkspaceFolder;
  expanded: boolean;
  isCurrent: boolean;
  isDefault: boolean;
  statusKind: StatusKind;
  onToggle: () => void;
  onAddSession: () => void;
  onMore: (position: { x: number; y: number }) => void;
}) {
  const t = useT();
  return (
    <div
      data-testid={`workspace-folder-${props.folder.directory}`}
      data-active={props.isCurrent ? "true" : "false"}
      data-default={props.isDefault ? "true" : "false"}
      class="group relative flex cursor-pointer select-none items-center gap-1.5 py-1.5 pl-3 pr-2 text-sm transition-colors hover:bg-bg-sunken/50"
      onClick={() => props.onToggle()}
    >
      <button
        type="button"
        data-testid="workspace-folder-toggle"
        aria-expanded={props.expanded ? "true" : "false"}
        aria-label={props.expanded ? t("sessions:collapse") : t("sessions:expand")}
        class={`shrink-0 rounded-sm p-0.5 text-xs leading-none text-fg-faint outline-none hover:text-fg-primary focus:text-fg-primary ${
          props.expanded ? "rotate-90" : ""
        }`}
        onClick={(event) => {
          // The chevron toggles alone: without stopping propagation the
          // click would ALSO hit the row's toggle, cancelling itself out.
          event.stopPropagation();
          props.onToggle();
        }}
      >
        ▸
      </button>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-4 w-4 shrink-0 text-fg-secondary"
      >
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </svg>
      <span class="min-w-0 flex-1 truncate" title={props.folder.directory}>
        {props.folder.name}
      </span>
      <Show when={props.isDefault}>
        <span
          data-testid="workspace-folder-default-badge"
          class="shrink-0 rounded-full border border-accent bg-accent-soft px-1.5 py-px text-[10px] leading-tight text-accent"
        >
          {t("sessions:defaultBadge")}
        </span>
      </Show>
      <Show when={props.folder.sessions.length > 0}>
        <span data-testid="workspace-folder-count" class="shrink-0 text-[10px] text-fg-faint">
          {props.folder.sessions.length}
        </span>
      </Show>
      <Show when={props.statusKind !== "none"}>
        <span
          data-testid="workspace-folder-status"
          data-status={props.statusKind}
          class={`shrink-0 ${statusDotClass(props.statusKind)}`}
        />
      </Show>
      {/* Hover actions (workspace layout redesign): new session here + ⋯
          menu (view folder / remove workspace). */}
      <div class="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          data-testid="workspace-folder-add"
          aria-label={t("sessions:addSessionHere")}
          title={t("sessions:addSessionHere")}
          onClick={(event) => {
            event.stopPropagation();
            props.onAddSession();
          }}
          class="flex h-6 w-6 items-center justify-center rounded-md text-fg-secondary outline-none hover:bg-bg-sunken hover:text-fg-primary focus:bg-bg-sunken focus:text-fg-primary"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            class="h-3.5 w-3.5"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          data-testid="workspace-folder-more"
          aria-label={t("sessions:moreActions")}
          title={t("sessions:moreActions")}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            props.onMore({ x: rect.left, y: rect.bottom });
          }}
          class="flex h-6 w-6 items-center justify-center rounded-md text-fg-secondary outline-none hover:bg-bg-sunken hover:text-fg-primary focus:bg-bg-sunken focus:text-fg-primary"
        >
          ⋯
        </button>
      </div>
    </div>
  );
}

function statusKindOf(status: SessionStatusEntry | undefined): StatusKind {
  if (status === undefined) return "none";
  if (status.type === "busy" || status.type === "retry") return "busy";
  if (status.type === "error") return "error";
  return "none";
}

/** A flat session row (no chevron / no subtree): status dot + title +
 *  relative time + ⋯ menu. Mirrors the SessionList row visuals without the
 *  parent-child tree plumbing (children are subtask-panel-only now). */
function SessionRow(props: {
  session: Session;
  status: SessionStatusEntry | undefined;
  active: boolean;
  nowMs: number;
  forked: boolean;
  parentTitle?: string;
  onSelect: () => void;
  onMenu: (session: Session, position: { x: number; y: number }) => void;
}) {
  const t = useT();
  const kind = () => statusKindOf(props.status);
  const message = () =>
    props.status !== undefined && "message" in props.status ? props.status.message : undefined;
  const title = () => props.session.title || props.session.slug;
  return (
    <div
      data-testid={`workspace-session-${props.session.id}`}
      data-active={props.active ? "true" : "false"}
      data-forked={props.forked ? "true" : "false"}
      role="button"
      tabindex="0"
      aria-label={title()}
      class={`group relative flex w-full cursor-pointer items-center gap-2 py-1.5 pl-3 pr-3 transition-colors ${
        props.active ? "bg-accent-soft" : "hover:bg-bg-sunken/50"
      } focus:bg-accent-soft focus:outline-none`}
      style={{ "padding-left": "calc(0.75rem + 28px)" }}
      onClick={() => props.onSelect()}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onMenu(props.session, { x: event.clientX, y: event.clientY });
      }}
    >
      <Show when={kind() !== "none"}>
        <span
          data-testid="workspace-session-status"
          data-status={kind()}
          title={message()}
          class={`shrink-0 ${statusDotClass(kind())}`}
        />
      </Show>
      <Show when={props.forked}>
        <span
          data-testid="workspace-session-fork-badge"
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
      <Show when={props.session.share !== undefined}>
        <span
          data-testid="workspace-session-shared-badge"
          title={t("sessions:sharedHint")}
          class="shrink-0 rounded-full border border-accent bg-accent-soft px-1.5 py-px text-[10px] leading-tight text-accent"
        >
          {t("sessions:sharedBadge")}
        </span>
      </Show>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm">{title()}</span>
        <span class="block truncate font-code text-xs text-fg-secondary">
          {formatRelativeTime(props.session.time.updated, props.nowMs)}
        </span>
      </span>
      <button
        type="button"
        data-testid="workspace-session-menu"
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

const WorkspaceTree: Component<WorkspaceTreeProps> = (props) => {
  const t = useT();
  // Local cross-directory session snapshot: the workspace tree spans every
  // directory, while the global session store only holds the ACTIVE
  // directory (per-directory SSE). listRoots() fills the snapshot; the
  // global store's live entries (SSE) are merged in below.
  const [localSessions, setLocalSessions] = createStore<Record<string, Session>>({});
  const [query, setQuery] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [createError, setCreateError] = createSignal<ApiError | null>(null);
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(readStringSet(COLLAPSED_KEY));
  const [hiddenFolders, setHiddenFolders] = createSignal<ReadonlySet<string>>(
    readStringSet(HIDDEN_KEY),
  );
  // Explicitly added workspaces (persisted): directories that would not
  // survive a restart otherwise (no sessions, no project record).
  const [explicitWorkspaces, setExplicitWorkspaces] = createSignal<string[]>([]);
  // The server's default workspace (persisted; null when unset). Kept as a
  // signal (not a memo) so runtime writes via DefaultWorkspaceDialog /
  // Settings — which go straight to localStorage — can refresh it through
  // the WORKSPACE_STORAGE_EVENT notification. A memo would cache the value
  // from the first read and never see the post-mount change, so a default
  // workspace picked in onboarding would not render until a remount (Bug 1).
  const [defaultWorkspace, setDefaultWorkspace] = createSignal<string | null>(null);

  function refreshWorkspaceStorage(): void {
    setExplicitWorkspaces(readWorkspaces(props.serverId));
    setDefaultWorkspace(readDefaultWorkspace(props.serverId));
  }

  // Re-read on mount and whenever the server changes (props.serverId read
  // inside the tracked scope keeps the effect reactive).
  createEffect(() => {
    refreshWorkspaceStorage();
  });

  // Re-read when another component writes the workspace/default storage:
  // DefaultWorkspaceDialog lives in DesktopShell and Settings in its own
  // dialog — neither can reach this component's state directly, so they
  // dispatch WORKSPACE_STORAGE_EVENT on write and we refresh here.
  onMount(() => {
    const handler = (): void => refreshWorkspaceStorage();
    window.addEventListener(WORKSPACE_STORAGE_EVENT, handler);
    onCleanup(() => window.removeEventListener(WORKSPACE_STORAGE_EVENT, handler));
  });
  // Row ⋯ menu target (session + position), and the dialog targets.
  const [rowMenu, setRowMenu] = createSignal<{ session: Session; x: number; y: number } | null>(
    null,
  );
  // Folder ⋯ menu target (workspace + position): view folder / remove.
  const [folderMenu, setFolderMenu] = createSignal<{
    directory: string;
    x: number;
    y: number;
  } | null>(null);
  const [renameTarget, setRenameTarget] = createSignal<Session | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<Session | null>(null);
  const [shareTarget, setShareTarget] = createSignal<Session | null>(null);
  const [summarizeTarget, setSummarizeTarget] = createSignal<Session | null>(null);
  const [initTarget, setInitTarget] = createSignal<Session | null>(null);
  // Open-folder picker: the directory it should start from (default root),
  // plus the open flag — "add directory" opens at the root (no directory),
  // so the open state must live separately from the start directory.
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerDir, setPickerDir] = createSignal<string | undefined>(undefined);

  const sessionState = createMemo(() => getServerSessionState(props.serverId));
  const projectState = createMemo(() => getServerProjectState(props.serverId));
  const now = () => Date.now();

  // Snapshot mutations.
  function applyLocalList(list: Session[]): void {
    const next: Record<string, Session> = {};
    for (const session of list) next[session.id] = session;
    setLocalSessions(next);
  }
  function upsertLocal(session: Session): void {
    // Full replacement, not a merge: `setStore(path, obj)` merges the object
    // into the stored one, which would keep stale fields (e.g. `share` after
    // an unshare clears the marker). produce assignment replaces wholesale.
    setLocalSessions(
      produce((draft) => {
        draft[session.id] = session;
      }),
    );
  }

  /** Full refresh of the cross-directory roots + project names. Called on
   *  mount, on server switch, on folder expand and after session mutations
   *  (keeps deletions/creations accurate). A sequence guard drops stale
   *  responses so a slow older refresh can never overwrite a newer snapshot.
   *
   *  Root sessions are pulled PER KNOWN WORKSPACE: opencode's GET /session
   *  without a directory only returns the GLOBAL (root) sessions — sessions
   *  created in a per-directory workspace (e.g. the user's added folders)
   *  require an explicit ?directory= query. Fetching only the global
   *  listing and replacing the snapshot made every workspace's sessions
   *  vanish from the tree as soon as the snapshot refreshed (Bug 2). */
  let refreshSeq = 0;
  function refresh(): void {
    const serverId = props.serverId;
    const seq = ++refreshSeq;
    const sessionService = createSessionService(getApiClient());
    const dirs = new Set<string>();
    for (const dir of explicitWorkspaces()) dirs.add(dir);
    const def = defaultWorkspace();
    if (def !== null) dirs.add(def);
    const requests: Promise<Session[]>[] = [];
    if (dirs.size === 0) {
      requests.push(sessionService.listRoots());
    } else {
      for (const dir of dirs) requests.push(sessionService.listRoots(dir));
    }
    Promise.all(requests)
      .then((lists) => {
        if (seq !== refreshSeq) return;
        applyLocalList(Array.isArray(lists) ? lists.flat() : []);
      })
      .catch(() => undefined);
    void createProjectService(getApiClient())
      .list()
      .then((list) => {
        if (seq !== refreshSeq) return;
        applyProjects(serverId, Array.isArray(list) ? list : []);
      })
      .catch(() => undefined);
  }

  createEffect(() => refresh());

  // Merge the global store's live entries (the active directory's SSE
  // stream) into the snapshot so the tree reflects activity in real time.
  // The whole sessions map is tracked (not just `order`): an upsert that
  // replaces an entry in place — e.g. unshare clearing `share` — must also
  // refresh the snapshot. Global resets (directory rebuild) only clear the
  // global store, never this snapshot — non-active folders stay intact
  // until the next refresh.
  createEffect(() => {
    const map = sessionStore[props.serverId]?.sessions ?? {};
    for (const session of Object.values(map)) {
      upsertLocal(session);
    }
  });

  const storeSessions = createMemo(() => Object.values(localSessions));
  // The rendered workspaces = the persisted explicit list + the default
  // workspace. With NO persisted workspaces yet the tree falls back to every
  // derived directory (existing servers / pre-onboarding); once the user
  // adds any workspace (or onboarding picks the default), the tree becomes
  // strictly that list — a fresh server shows only its default workspace
  // until more are added (Bug 3: workspaces are never auto-filled from the
  // server's history, only the user's explicit list + default render).
  const workspaceDirectories = createMemo(() => {
    const set = new Set(explicitWorkspaces());
    const def = defaultWorkspace();
    if (def !== null) set.add(def);
    return set.size === 0 ? undefined : set;
  });
  const tree = createMemo(() => {
    const projects: Project[] = projectState().projects;
    const only = workspaceDirectories();
    const built = buildWorkspaceTree(storeSessions(), projects, only);
    // Default + explicit workspaces always render, even with no
    // sessions/projects yet (the persisted workspace list).
    if (only !== undefined) {
      for (const directory of only) {
        if (built.folders.some((folder) => folder.directory === directory)) continue;
        built.folders.push({
          directory,
          name: basename(directory),
          project: undefined,
          sessions: [],
          recentMs: 0,
        });
      }
    }
    return built;
  });

  // Search filter: a folder stays visible when any of its sessions (or the
  // folder name itself) matches; matching folders are force-expanded.
  const filteredTree = createMemo(() => {
    const q = query().trim().toLowerCase();
    const { folders, uncategorized } = tree();
    if (q === "") return { folders, uncategorized, matched: new Set<string>() };
    const matched = new Set<string>();
    const folderMatches = (folder: WorkspaceFolder): boolean => {
      if (folder.name.toLowerCase().includes(q) || folder.directory.toLowerCase().includes(q)) {
        return true;
      }
      return folder.sessions.some((s) => `${s.title || ""} ${s.slug}`.toLowerCase().includes(q));
    };
    const foldersIn = folders.filter((folder) => {
      const m = folderMatches(folder);
      if (m) matched.add(folder.directory);
      return m;
    });
    const uncatIn = uncategorized.filter((s) =>
      `${s.title || ""} ${s.slug}`.toLowerCase().includes(q),
    );
    return { folders: foldersIn, uncategorized: uncatIn, matched };
  });

  const visibleFolders = createMemo(() =>
    filteredTree().folders.filter((folder) => !hiddenFolders().has(folder.directory)),
  );

  // Workspace-layout grouping: the default workspace is pinned to the top
  // and visually separated (default badge + divider) from the rest.
  const defaultFolder = createMemo<WorkspaceFolder | undefined>(() => {
    const target = defaultWorkspace();
    if (target === null) return undefined;
    return visibleFolders().find((folder) => folder.directory === target);
  });
  const otherFolders = createMemo(() =>
    visibleFolders().filter((folder) => folder.directory !== defaultFolder()?.directory),
  );

  // Enter the most recent directory when no context is seeded yet (first
  // mount / server switch): the per-directory SSE stream and the main pane
  // need a current directory to attach to. Setting it triggers DesktopShell
  // to rebuild the stream — a one-time cost on entry, like the old project
  // switcher's seed. Selecting a session switches the context afterwards.
  // Hidden folders never auto-enter (the user explicitly hid them).
  createEffect(() => {
    const folders = visibleFolders();
    if (projectState().current !== null || folders.length === 0) return;
    setCurrent(props.serverId, folders[0].directory);
  });

  // Un-hide a folder the user actively re-entered (e.g. via the directory
  // picker's "Add"): the current directory leaving the hidden set restores
  // its row, so a hidden folder is never unrecoverable.
  // untrack(hiddenFolders): the effect must react ONLY to the current
  // directory changing — NOT to the hidden set changing. Removing a
  // workspace writes the hidden set; if the removed folder happens to be
  // the auto-entered current directory, an effect that re-runs on hidden
  // writes would immediately un-hide it and undo the removal (Bug: "Remove
  // workspace" did not stick for the active folder).
  createEffect(() => {
    const current = projectState().current;
    if (current === null) return;
    const next = new Set(untrack(() => hiddenFolders()));
    if (next.delete(current)) {
      setHiddenFolders(next);
      writeStringSet(HIDDEN_KEY, next);
    }
  });

  function isExpanded(directory: string, matched: ReadonlySet<string>): boolean {
    return matched.has(directory) || !collapsed().has(directory);
  }

  function toggleFolder(directory: string): void {
    const next = new Set(collapsed());
    if (next.has(directory)) next.delete(directory);
    else {
      next.add(directory);
      // Expanding a folder re-syncs its sessions (deletes/creates land).
      refresh();
    }
    setCollapsed(next);
    writeStringSet(COLLAPSED_KEY, next);
  }

  function removeFolder(directory: string): void {
    const next = new Set(hiddenFolders());
    next.add(directory);
    setHiddenFolders(next);
    writeStringSet(HIDDEN_KEY, next);
    // If the removed folder was the active context, leave it: the auto-enter
    // effect picks the next visible workspace, and the un-hide effect would
    // otherwise restore the removed folder (its directory is still current),
    // so "Remove workspace" would not stick for the folder you are in.
    if (projectState().current === directory) {
      setCurrent(props.serverId, null);
    }
    // Dropping a workspace also forgets it in the persisted explicit list,
    // so a removed workspace stays gone after a restart.
    dropWorkspace(props.serverId, directory);
    setExplicitWorkspaces(readWorkspaces(props.serverId));
  }

  /** Selects a session; when it belongs to a different directory than the
   *  active one, switch the context there first (DesktopShell rebuilds the
   *  per-directory SSE stream), then re-select the picked session once the
   *  new directory's list settles. */
  async function selectSession(session: Session): Promise<void> {
    setActiveSession(props.serverId, session.id);
    const current = projectState().current;
    if (session.directory !== undefined && session.directory !== current) {
      setCurrent(props.serverId, session.directory);
      pushRecentProject(props.serverId, session.directory);
      await ensureSessionInDirectory(props.serverId, createSessionService(getApiClient()));
      // ensureSessionInDirectory picks the first session of the directory;
      // restore the user's actual pick.
      setActiveSession(props.serverId, session.id);
    }
    props.onSelectSession(session.id);
  }

  async function handleCreate(): Promise<void> {
    if (creating()) return;
    setCreating(true);
    setCreateError(null);
    try {
      // The header "+" creates inside the DEFAULT workspace when one is set
      // (workspace layout redesign); otherwise the plain (current-directory)
      // flow applies.
      const target = defaultWorkspace();
      const session = await createSession(
        props.serverId,
        createSessionService(getApiClient()),
        target ?? undefined,
      );
      // The created session may belong to the injected (current) directory;
      // make it visible in the tree right away.
      upsertLocal(session);
      selectSession(session);
    } catch (err) {
      setCreateError(ApiError.fromUnknown(err));
    } finally {
      setCreating(false);
    }
  }

  /** Creates a session directly in the given workspace (folder [+] button). */
  async function handleCreateIn(directory: string): Promise<void> {
    if (creating()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const session = await createSession(
        props.serverId,
        createSessionService(getApiClient()),
        directory,
      );
      upsertLocal(session);
      selectSession(session);
    } catch (err) {
      setCreateError(ApiError.fromUnknown(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleFork(session: Session): Promise<void> {
    try {
      await forkSession(
        props.serverId,
        session.id,
        undefined,
        createSessionService(getApiClient()),
      );
    } catch {
      // Fork failures surface in the row menu's caller only; ignore here.
    }
  }

  function parentTitleOf(session: Session): string | undefined {
    if (session.parentID === undefined) return undefined;
    const parent = sessionState().sessions[session.parentID] ?? localSessions[session.parentID];
    return parent === undefined ? undefined : parent.title || parent.slug;
  }

  /** Row ⋯ menu (WorkBuddy-style): batch (disabled placeholder), open
   *  folder, then the existing session actions; delete is danger-red. */
  const rowMenuItems = createMemo<MenuItem[]>(() => {
    const target = rowMenu();
    if (target === null) return [];
    const session = target.session;
    return [
      {
        id: "batch",
        label: t("sessions:batchActions"),
        disabled: true,
        hint: t("sessions:comingSoon"),
      },
      {
        id: "open-folder",
        label: t("sessions:openFolder"),
        icon: (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
        ),
        onSelect: () => {
          setPickerDir(session.directory);
          setPickerOpen(true);
        },
      },
      { separator: true },
      { id: "fork", label: t("sessions:fork"), onSelect: () => void handleFork(session) },
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
        label: t("sessions:delete"),
        danger: true,
        onSelect: () => setDeleteTarget(session),
      },
    ];
  });

  /** Folder ⋯ menu: view the workspace's files / remove the workspace. */
  const folderMenuItems = createMemo<MenuItem[]>(() => {
    const target = folderMenu();
    if (target === null) return [];
    return [
      {
        id: "view-folder",
        label: t("sessions:viewFolder"),
        icon: (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
        ),
        onSelect: () => props.onViewFolder(target.directory),
      },
      { separator: true },
      {
        id: "remove-workspace",
        label: t("sessions:removeWorkspace"),
        danger: true,
        onSelect: () => removeFolder(target.directory),
      },
    ];
  });

  return (
    <div data-testid="workspace-tree" class="flex min-h-0 flex-1 flex-col">
      <div class="px-3 pb-1.5 pt-2">
        <div class="pt-1.5">
          <ErrorBanner error={createError()} onDismiss={() => setCreateError(null)} />
        </div>
        <button
          type="button"
          data-testid="workspace-new-session"
          class="mb-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary focus:border-fg-faint disabled:cursor-not-allowed disabled:opacity-50"
          disabled={creating()}
          onClick={() => void handleCreate()}
        >
          + {t("sessions:newSession")}
        </button>
        <button
          type="button"
          data-testid="workspace-add-workspace"
          class="mb-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary focus:border-fg-faint"
          onClick={() => {
            setPickerDir(undefined);
            setPickerOpen(true);
          }}
        >
          + {t("sessions:addWorkspace")}
        </button>
        <input
          type="search"
          data-testid="workspace-search"
          aria-label={t("sessions:search")}
          placeholder={t("sessions:search")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          class="w-full rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1 text-xs outline-none placeholder:text-fg-faint focus:border-fg-faint"
        />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto pb-3">
        <Show
          when={visibleFolders().length > 0 || filteredTree().uncategorized.length > 0}
          fallback={
            <Show
              when={storeSessions().length === 0 && projectState().projects.length === 0}
              fallback={
                <div data-testid="workspace-empty-filter" class="px-3 py-6 text-center">
                  <p class="text-sm text-fg-secondary">{t("sessions:noMatching")}</p>
                </div>
              }
            >
              <div data-testid="workspace-empty" class="px-3 py-6 text-center">
                <p class="text-sm text-fg-secondary">{t("sessions:workspaceEmpty")}</p>
                <p class="mt-1 text-xs text-fg-faint">{t("sessions:workspaceEmptyHint")}</p>
                <button
                  type="button"
                  data-testid="workspace-empty-add"
                  class="mt-3 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1.5 text-sm text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary focus:border-fg-faint"
                  onClick={() => {
                    setPickerDir(undefined);
                    setPickerOpen(true);
                  }}
                >
                  + {t("sessions:addDirectory")}
                </button>
              </div>
            </Show>
          }
        >
          <Show when={defaultFolder() !== undefined}>
            <FolderRow
              folder={defaultFolder()!}
              expanded={isExpanded(defaultFolder()!.directory, filteredTree().matched)}
              isCurrent={projectState().current === defaultFolder()!.directory}
              isDefault
              statusKind={folderStatusKind(
                defaultFolder()!,
                projectState().current === defaultFolder()!.directory,
                sessionState().statuses,
              )}
              onToggle={() => toggleFolder(defaultFolder()!.directory)}
              onAddSession={() => void handleCreateIn(defaultFolder()!.directory)}
              onMore={(position) =>
                setFolderMenu({ directory: defaultFolder()!.directory, ...position })
              }
            />
          </Show>
          <Show when={defaultFolder() !== undefined && otherFolders().length > 0}>
            <div
              data-testid="workspace-divider"
              class="mx-3 my-1 border-t border-bg-sunken"
              role="separator"
            />
          </Show>
          <For each={otherFolders()}>
            {(folder) => {
              const expanded = () => isExpanded(folder.directory, filteredTree().matched);
              const isCurrent = () => projectState().current === folder.directory;
              const statusKind = () =>
                folderStatusKind(folder, isCurrent(), sessionState().statuses);
              return (
                <section data-testid={`workspace-folder-section-${folder.directory}`}>
                  <FolderRow
                    folder={folder}
                    expanded={expanded()}
                    isCurrent={isCurrent()}
                    isDefault={false}
                    statusKind={statusKind()}
                    onToggle={() => toggleFolder(folder.directory)}
                    onAddSession={() => void handleCreateIn(folder.directory)}
                    onMore={(position) =>
                      setFolderMenu({ directory: folder.directory, ...position })
                    }
                  />
                  <Show when={expanded()}>
                    <For each={folder.sessions}>
                      {(session) => (
                        <SessionRow
                          session={session}
                          status={sessionState().statuses[session.id]}
                          active={sessionState().activeSessionId === session.id}
                          nowMs={now()}
                          forked={session.parentID !== undefined}
                          parentTitle={parentTitleOf(session)}
                          onSelect={() => void selectSession(session)}
                          onMenu={(target, position) =>
                            setRowMenu({ session: target, ...position })
                          }
                        />
                      )}
                    </For>
                  </Show>
                </section>
              );
            }}
          </For>
          <Show when={filteredTree().uncategorized.length > 0}>
            <section data-testid="workspace-folder-section-uncategorized">
              <FolderRow
                folder={{
                  directory: "",
                  name: t("sessions:uncategorized"),
                  sessions: filteredTree().uncategorized,
                  recentMs: 0,
                }}
                expanded={!collapsed().has("__uncategorized__")}
                isCurrent={false}
                isDefault={false}
                statusKind="none"
                onToggle={() => toggleFolder("__uncategorized__")}
                onAddSession={() => undefined}
                onMore={() => undefined}
              />
              <Show when={!collapsed().has("__uncategorized__")}>
                <For each={filteredTree().uncategorized}>
                  {(session) => (
                    <SessionRow
                      session={session}
                      status={sessionState().statuses[session.id]}
                      active={sessionState().activeSessionId === session.id}
                      nowMs={now()}
                      forked={session.parentID !== undefined}
                      parentTitle={parentTitleOf(session)}
                      onSelect={() => void selectSession(session)}
                      onMenu={(target, position) => setRowMenu({ session: target, ...position })}
                    />
                  )}
                </For>
              </Show>
            </section>
          </Show>
        </Show>
      </div>

      {/* Open-folder picker: positioned at the target directory (defaults
          to the filesystem root when no directory is given). Adding a
          directory also records it in the persisted workspace list. */}
      <Show when={pickerOpen()}>
        <DirectoryPickerDialog
          serverId={props.serverId}
          initialDirectory={pickerDir()}
          onAdded={(directory) => {
            addWorkspace(props.serverId, directory);
            setExplicitWorkspaces(readWorkspaces(props.serverId));
          }}
          onClose={() => setPickerOpen(false)}
        />
      </Show>

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
            onClose={() => {
              setDeleteTarget(null);
              // The delete removed the session from the global store; drop
              // it from the cross-directory snapshot too.
              refresh();
            }}
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
      <Show when={rowMenu() !== null}>
        <ContextMenu
          testId="workspace-session-menu"
          label={t("sessions:sessionActions")}
          x={rowMenu()!.x}
          y={rowMenu()!.y}
          items={rowMenuItems()}
          onClose={() => setRowMenu(null)}
        />
      </Show>

      {/* Folder ⋯ menu (workspace layout redesign): view the workspace's
          files in the main pane, or remove it from the list (persisted). */}
      <Show when={folderMenu() !== null}>
        <ContextMenu
          testId="workspace-folder-menu"
          label={t("sessions:moreActions")}
          x={folderMenu()!.x}
          y={folderMenu()!.y}
          items={folderMenuItems()}
          onClose={() => setFolderMenu(null)}
        />
      </Show>
    </div>
  );
};

export default WorkspaceTree;
