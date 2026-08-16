// Desktop workspace shell (TASK-M1-08): the three-column skeleton (Rail |
// Sidebar | Main) mounted when a server is opened from ServerHome. Mounting
// sets the active server context (registry store); unmounting clears it and
// tears down that server's SSE stream. The rail mirrors the server list
// (listServers + servers-changed) with a health dot per server and offers
// ⌘/Ctrl+1..9 switching in list order. The sidebar holds the project/folder
// switcher (TASK-M2-03) on top and, below, a view switch (TASK-M4-02)
// toggling between the session list (TASK-M2-04) and the files tree; the
// main pane shows the chat transcript (TASK-M2-06) for the store's active
// session id (set by row selection and by the "New session" flow,
// TASK-M2-05), keeping a placeholder only while no session is open. A
// Main-area tab bar (TASK-M4-03) switches between Chat and Files: the
// Files tab mounts the tabbed file viewer, and clicking a file in the
// sidebar tree opens its tab and switches Main to Files. ⌘/Ctrl+P opens
// the QuickOpen file search dialog (TASK-M4-04; the shortcut moves to the
// M8 command-palette registry) whose picks jump Main to Files the same
// way. The Files view holds the tabbed viewer and the full-text search
// panel (TASK-M4-05) side by side, toggled by ⌘/Ctrl+⇧F or the search
// button; both stay mounted so search results survive hit navigation.
// TASK-M4-08 adds the VCS changes view (a git button in the Files tab bar
// opens it; its own Back header returns to Files) and a bottom status bar
// whose branch chip follows the vcs store (one GET /vcs per server on
// mount and after each re-sync that clears the store bucket;
// `vcs.branch.updated` SSE events and the VCS panel keep it fresh;
// M9-07 extends the bar with LSP/formatter/tokens). TASK-M6-02 adds the
// terminal view (a terminal icon in the Chat|Files tab bar or the
// provisional ⌘/Ctrl+J hook opens it; its own Back header returns to
// chat, like the settings view).
// TASK-M8-01: every key-driven action below lives in the shortcut
// registry (features/settings/shortcuts.ts + useShortcuts), which owns
// the full ui-design §3.3 default table and the user customizations. This
// shell registers the actions whose features exist here (command palette,
// quick open, full-text search, session diff, terminal, new session,
// server digits, session stepping, sidebar toggle, settings); the input
// locals (⌘Enter send, Tab agent cycle, ↑ last prompt, Esc
// interrupt/close) stay inside PromptBox and the sheets — the shell does
// not register them, but the composer reads the registry's effective
// combos (effectiveCombo) so customizations apply there too. The
// active-scope signal follows the focused main area (chat / list /
// global) for the registry's scope gating.
// This shell owns the per-directory SSE subscription and rebuilds
// it whenever the active server or the active directory changes,
// re-syncing the stores so sessions and messages never mix across contexts.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js";
import type { Component } from "solid-js";
import ContextMenu from "../../components/ContextMenu.js";
import type { MenuItem } from "../../components/ContextMenu.js";
import { quoteBlock } from "../../components/ContextMenu.js";
import { prefillComposer } from "../../stores/composer.js";
import { subscribeToServersChanged } from "../../services/events";
import { listServers } from "../../services/servers";
import type { ServerEntry } from "../../services/servers";
import { getApiClient } from "../../services/client";
import { ApiError } from "../../services/errors";
import ErrorBanner from "../../components/ErrorBanner.js";
import { useT } from "../../i18n/index.js";
import Toasts from "../../components/Toast.js";
import { createProjectService } from "../../services/project";
import { createSessionService, type Session } from "../../services/session";
import { createCommandService } from "../../services/command";
import { createVcsService } from "../../services/vcs";
import {
  createSession,
  forkSession,
  revertSession,
  unrevertSession,
} from "../../features/sessions/sessionActions.js";
import { useShortcuts } from "../../features/settings/useShortcuts.js";
import type { Scope } from "../../features/settings/shortcuts.js";
import RevertMessageDialog from "../../features/messages/RevertMessageDialog";
import ShareSessionDialog from "../../features/sessions/ShareSessionDialog";
import { connections, subscribeToServerHealth } from "../../stores/connection";
import { registry, setActiveServer } from "../../stores/registry";
import {
  hasWorkspaceHistory,
  markDefaultWorkspacePrompted,
  wasDefaultWorkspacePrompted,
} from "../../features/servers/defaultWorkspace.js";
import { getServerProjectState, setCurrent } from "../../stores/project";
import {
  getServerSessionState,
  resetServer as resetSessions,
  setActiveSession,
  takeRestoreCandidate,
} from "../../stores/session";
import { resetServer as resetMessages } from "../../stores/messages";
import { resetServer as resetTodos } from "../../stores/todos";
import { openTab, resetServer as resetViewer } from "../../stores/viewer";
import { subscribeToServerEvents, type SubscribeToServerEventsResult } from "../../stores/events";
import PromptBox from "../../features/sessions/PromptBox";
import SessionErrorBanner from "../../features/sessions/SessionErrorBanner";
import WorkspaceTree from "../../features/sessions/WorkspaceTree";
import TaskPanel from "../../features/sessions/TaskPanel";
import DefaultWorkspaceDialog from "../../features/sessions/DefaultWorkspaceDialog";
import { pushRecentProject } from "../../features/sessions/recentProjects.js";
import MessageList from "../../features/messages/MessageList";
import FileTree from "../../features/files/FileTree";
import FileViewer from "../../features/files/FileViewer";
import QuickOpen from "../../features/files/QuickOpen";
import SearchPanel, { SearchIcon } from "../../features/files/SearchPanel";
import DiffView from "../../features/vcs/DiffView";
import VcsPanel from "../../features/vcs/VcsPanel";
import { resetServer as resetDiffs } from "../../stores/diff";
import { applyVcs, vcs } from "../../stores/vcs";
import { resetServer as resetPermissions } from "../../stores/permission";
import { createToast } from "../../stores/toasts";
import PermissionSheet from "../../features/permissions/PermissionSheet";
import QuestionSheet from "../../features/questions/QuestionSheet";
import SettingsDialog from "../../features/settings/SettingsDialog";
// TASK-M9-08: the terminal panel (and with it the xterm.js bundle) is
// loaded lazily — the view is only mounted on demand, so xterm stays out of
// the startup chunk (bundle-size budget, docs/performance.md).
const TerminalPanel = lazy(() => import("../../features/terminal/TerminalPanel"));
import CommandPalette from "./CommandPalette";
import { subscribeToGlobalSummon, subscribeToTrayNewSession } from "../../services/tray.js";
import { startTrayBadgeSync } from "../../services/trayBadge.js";
import { applyDesktopPrefs, petEnabled } from "../../features/settings/desktopPrefs.js";
import { installLogCapture } from "../../features/settings/diagnostics/logCapture.js";
import {
  forwardLogsEnabled,
  startLogForwarding,
} from "../../features/settings/diagnostics/logForward.js";
import { showPet } from "../../services/pet.js";
import { createLspService } from "../../services/lsp.js";
import { applyFormatters, applyLsp, getLspState } from "../../stores/lsp.js";
import { formatCost, formatTokens, usageOf } from "./statusBar.js";
import { startNotifications } from "../../services/notificationEvents.js";
import { startAutoTitler } from "../../features/sessions/autoTitle.js";
import { startPetWatcher } from "../../features/pet/petEvents.js";
import { focusWindow, subscribeToNotificationClick } from "../../services/notifications.js";
import {
  checkForUpdates,
  loadLastCheck,
  recordLastCheck,
  shouldAutoCheck,
} from "../../services/updates.js";
import { serverUpdate, clearServerUpdate } from "../../stores/serverUpdate.js";

export interface DesktopShellProps {
  /** The server opened from the home screen (initially active). */
  server: ServerEntry;
  /** Called to leave the workspace and return to the servers home. */
  onExit: () => void;
}

type HealthKind = "ok" | "slow" | "down" | "unknown";

const dotClass: Record<HealthKind, string> = {
  ok: "bg-success",
  slow: "bg-warning",
  down: "bg-danger",
  unknown: "bg-fg-faint",
};

function healthKind(server: ServerEntry): HealthKind {
  return connections[server.id]?.status ?? "unknown";
}

/** Chat header title: the server-provided title, falling back to the slug
 *  and finally the raw session id. Reads the reactive store directly. */
function titleOf(serverId: string, sessionId: string): string {
  const session = getServerSessionState(serverId).sessions[sessionId];
  return session ? session.title || session.slug || sessionId : sessionId;
}

/** The stored session object for a session id (undefined when absent). */
function sessionOf(serverId: string, sessionId: string): Session | undefined {
  return getServerSessionState(serverId).sessions[sessionId];
}

/**
 * Status-bar branch chip (TASK-M4-08): the minimal status bar entry, driven
 * by the vcs store so `vcs.branch.updated` events update it live. The
 * branch is fetched once per server (GET /vcs) when the chip mounts or the
 * store bucket is cleared (re-sync); the VCS panel and branch events keep
 * it fresh afterwards. Hidden while no branch is known (non-git workspace).
 */
function StatusBarBranch(props: { serverId: string }) {
  const t = useT();
  // Servers whose info fetch was already issued (or is in flight).
  const fetched = new Set<string>();
  createEffect(() => {
    const serverId = props.serverId;
    const bucket = vcs[serverId];
    // Fetch when the bucket is missing — never fetched on mount or dropped
    // by a re-sync (resetServer clears it). The fetched guard only applies
    // once a bucket exists: a successful fetch leaves one behind (null
    // branch = non-git), so the chip never refetches; a failed fetch drops
    // the guard so the next bucket change / context rebuild retries.
    if (fetched.has(serverId) && bucket !== undefined) return;
    fetched.add(serverId);
    void createVcsService(getApiClient())
      .info()
      .then((info) => applyVcs(serverId, info))
      .catch(() => {
        // Unreachable server: the chip stays hidden until an event or a
        // later bucket change / context rebuild retries the fetch.
        fetched.delete(serverId);
      });
  });
  const branch = createMemo(() => vcs[props.serverId]?.branch ?? null);
  return (
    <Show when={branch() !== null}>
      <span
        data-testid="status-bar-branch"
        title={t("vcs:currentBranch")}
        class="flex shrink-0 items-center gap-1.5 font-code text-xs text-fg-secondary"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <circle cx="6" cy="6" r="2.4" />
          <circle cx="6" cy="18" r="2.4" />
          <circle cx="18" cy="8" r="2.4" />
          <path d="M6 8.4v7.2M6 8.4a5 5 0 0 0 5 5h5" />
        </svg>
        {branch()}
      </span>
    </Show>
  );
}

/**
 * Status-bar LSP chip (TASK-M9-07): shows the number of connected LSP
 * servers. GET /lsp is fetched on mount and after every context rebuild
 * (the lsp store bucket is cleared on re-sync); the `lsp.updated` SSE
 * event carries an empty payload (verified EventLspUpdated), so it only
 * bumps the store's version counter and the chip refetches. Hidden until
 * the first fetch lands.
 */
function StatusBarLsp(props: { serverId: string }) {
  const t = useT();
  // Version whose fetch already completed (or is in flight).
  let lastFetchedVersion = -1;
  createEffect(() => {
    const serverId = props.serverId;
    const state = getLspState(serverId);
    if (state.loaded && lastFetchedVersion === state.version) return;
    lastFetchedVersion = state.version;
    void createLspService(getApiClient())
      .status()
      .then((statuses) => applyLsp(serverId, statuses))
      .catch(() => {
        // Unreachable server: retry on the next version bump / rebuild.
        lastFetchedVersion = -1;
      });
  });
  const activeCount = createMemo(
    () => getLspState(props.serverId).lsp.filter((entry) => entry.status === "connected").length,
  );
  return (
    <Show when={getLspState(props.serverId).loaded}>
      <span
        data-testid="status-bar-lsp"
        title={t("desktop:lspHint")}
        class="flex shrink-0 items-center gap-1.5 font-code text-xs text-fg-secondary"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M12 3v3M12 12v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        </svg>
        {activeCount()}
      </span>
    </Show>
  );
}

/**
 * Status-bar formatter chip (TASK-M9-07): shows the enabled formatter
 * names (GET /formatter, fetched once per mount / context rebuild — there
 * is no formatter event, so no refresh signal). Hidden while no formatter
 * is enabled.
 */
function StatusBarFormatter(props: { serverId: string }) {
  const t = useT();
  createEffect(() => {
    const serverId = props.serverId;
    if (getLspState(serverId).formattersLoaded) return;
    void createLspService(getApiClient())
      .formatters()
      .then((formatters) => applyFormatters(serverId, formatters))
      .catch(() => {
        // A failed fetch retries on the next context rebuild (the store
        // bucket is cleared on re-sync).
      });
  });
  const names = createMemo(() =>
    getLspState(props.serverId)
      .formatters.filter((entry) => entry.enabled)
      .map((entry) => entry.name),
  );
  return (
    <Show when={names().length > 0}>
      <span
        data-testid="status-bar-formatter"
        title={t("desktop:formatterHint")}
        class="flex shrink-0 items-center gap-1.5 font-code text-xs text-fg-secondary"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="m14.5 4.5 5 5M9 15l-1.5 1.5a2.1 2.1 0 1 1-3-3L6 12 13.5 4.5a2.1 2.1 0 1 1 3 3L10 14" />
        </svg>
        {names().join(", ")}
      </span>
    </Show>
  );
}

/**
 * Status-bar usage chip (TASK-M9-07): the active session's tokens and
 * cost, read straight from the session store. The 1.18.11 Session schema
 * carries server-computed `tokens` (input/output/reasoning/cache) and
 * `cost` fields, kept fresh by `session.updated` SSE events — the
 * authoritative source (no client-side estimation). Hidden while no
 * session is active or the server reported no usage yet.
 */
function StatusBarUsage(props: { serverId: string }) {
  const t = useT();
  const usage = createMemo(() => {
    const state = getServerSessionState(props.serverId);
    const sessionId = state.activeSessionId;
    if (sessionId === null) return undefined;
    return usageOf(state.sessions[sessionId]);
  });
  return (
    <Show when={usage() !== undefined}>
      <span
        data-testid="status-bar-usage"
        title={t("desktop:usageHint")}
        class="ml-auto flex shrink-0 items-center gap-1.5 font-code text-xs text-fg-secondary"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v10M15.5 10a3.5 3.5 0 0 0-1.3-.8 3 3 0 0 0-2.3 0 3 3 0 0 0-1.4 4 3 3 0 0 0 1.4 1.3 3 3 0 0 0 2.3 0 3.5 3.5 0 0 0 1.3-1" />
        </svg>
        {formatTokens(usage()!.tokens)} · {formatCost(usage()!.cost)}
      </span>
    </Show>
  );
}

const DesktopShell: Component<DesktopShellProps> = (props) => {
  const t = useT();
  const [servers, setServers] = createSignal<ServerEntry[]>([]);
  // Main-pane placeholder target: the store's active session id, so both
  // row selection and the "New session" flow update it. The per-server
  // bucket is wiped on every context rebuild, so the placeholder can never
  // show a session from another server's context.
  const activeServerId = () => registry.activeServerId ?? props.server.id;
  const activeSessionId = createMemo(() => getServerSessionState(activeServerId()).activeSessionId);
  // Task panel (composer dock): the header "Tasks" button force-expands
  // the panel above the composer (the panel itself auto-expands/collapses).
  const [taskExpandToken, setTaskExpandToken] = createSignal(0);
  // Sidebar view switch (TASK-M4-02): Sessions list or the Files tree.
  const [sidebarView, setSidebarView] = createSignal<"sessions" | "files">("sessions");
  // The directory the sidebar file tree browses (undefined = the server's
  // default); set by the workspace ⋯ menu's "View folder".
  const [filesDirectory, setFilesDirectory] = createSignal<string | undefined>(undefined);
  // Main pane view switch (TASK-M4-03): Chat transcript or the Files
  // viewer; opening a file from the sidebar tree jumps Main to Files.
  // TASK-M4-07 adds the session/message diff view (⌘/Ctrl+D or the
  // message menu's "View diff"), reached through its own header's back
  // button; the Chat|Files tab bar is hidden while it is open. TASK-M4-08
  // adds the Changes view (VCS panel), opened from the Files tab bar's git
  // button, with the tab bar hidden while it is open like the diff view.
  // TASK-M5-06 adds the Settings view (gear button in the tab bar; its own
  // Back header returns to the chat view), the base for the M9-04 settings
  // center. TASK-M6-02 adds the Terminal view (terminal icon in the tab
  // bar or the provisional ⌘/Ctrl+J hook; its own Back header returns to
  // chat, and the tab bar is hidden while it is open like the others).
  const [mainView, setMainView] = createSignal<"chat" | "files" | "diff" | "changes" | "terminal">(
    "chat",
  );
  // Settings dialog (TASK-UI-01): settings floats above the active view
  // as a modal instead of replacing it — the gear button, the command
  // palette's settings action and the ⌘, shortcut open this dialog.
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  // Default-workspace onboarding (feat(default-workspace)): opened on first
  // entry of a server with no workspace history (see onMount).
  const [defaultWorkspaceOpen, setDefaultWorkspaceOpen] = createSignal(false);
  // Diff message filter (TASK-M4-07): set when opened from a message's
  // "View diff"; the diff header's chip clears it back to the whole
  // session's diff.
  const [diffMessageId, setDiffMessageId] = createSignal<string | undefined>(undefined);
  // Files pane mode (TASK-M4-05): the tabbed viewer or the full-text
  // search panel. Both stay mounted (hidden via CSS) so search results
  // survive the round trip when a hit switches back to the viewer.
  const [filesMode, setFilesMode] = createSignal<"viewer" | "search">("viewer");
  // Quick open dialog (TASK-M4-04): toggled by the ⌘/Ctrl+P registry
  // action (TASK-M8-01), wired by useShortcuts below.
  const [quickOpen, setQuickOpen] = createSignal(false);
  // Command palette dialog (TASK-M8-02): toggled by the ⌘/Ctrl+K registry
  // action; the palette aggregates sessions/files/symbols/commands/
  // settings/servers and delegates every execution back to the handlers
  // below (this signal + the actions prop).
  const [commandPalette, setCommandPalette] = createSignal(false);
  // Sidebar visibility (TASK-M8-01): ⌘/Ctrl+B collapses and restores the
  // sidebar aside; the rail stays put as the toggle affordance.
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  // Shortcut dispatch scope (TASK-M8-01): follows the focused main area
  // (chat input / session list), "global" otherwise; gates the registry's
  // chat/list-scoped shortcuts.
  const [activeScope, setActiveScope] = createSignal<Scope>("global");
  // Message-fork errors (TASK-M6-03): the inline banner above the chat.
  const [forkError, setForkError] = createSignal<ApiError | null>(null);
  // Revert flow (TASK-M6-04): the message awaiting confirmation, and the
  // banner for unrevert failures (revert failures stay in the dialog).
  const [revertTarget, setRevertTarget] = createSignal<{
    sessionId: string;
    messageID: string;
  } | null>(null);
  const [revertError, setRevertError] = createSignal<ApiError | null>(null);
  // Share dialog target (TASK-M6-05): the session object is captured at
  // open time so a mid-flight session switch cannot reroute the dialog.
  const [shareTarget, setShareTarget] = createSignal<Session | null>(null);
  // Selected-text context menu (TASK-M8-03): window-level right-click (or
  // the Menu key on any element) with a non-empty selection — and no more
  // specific menu (message/file/session rows preventDefault their own)
  // — opens the text menu (Copy / Quote in chat) at the cursor.
  const [textMenu, setTextMenu] = createSignal<{ x: number; y: number; selection: string } | null>(
    null,
  );

  /** Opens the diff view, optionally filtered to one message. */
  function openDiff(messageId?: string) {
    setDiffMessageId(messageId);
    setMainView("diff");
  }

  /** Creates a session (⌘/Ctrl+N registry action); the new session opens
   *  in the store, a failure surfaces in the inline banner above the chat. */
  async function handleNewSession() {
    setForkError(null);
    try {
      await createSession(activeServerId(), createSessionService(getApiClient()));
    } catch (err) {
      setForkError(ApiError.fromUnknown(err));
    }
  }

  /** Steps the active session by `delta` through the store's render order
   *  (⌘/Ctrl+[ / ] registry actions), wrapping at both ends. */
  function stepSession(delta: number) {
    const st = getServerSessionState(activeServerId());
    if (st.order.length === 0) return;
    const current = st.activeSessionId;
    const index = current === null ? -1 : st.order.indexOf(current);
    // A stale active id (dropped session) restarts from the first row.
    const start = index < 0 ? 0 : index;
    const next = (start + delta + st.order.length) % st.order.length;
    setActiveSession(activeServerId(), st.order[next]);
  }

  /** Forks the session (optionally from a message point); the child opens
   *  in the store (upsert + set active), a failure surfaces inline. */
  async function handleFork(sessionId: string, messageID?: string) {
    setForkError(null);
    try {
      await forkSession(
        activeServerId(),
        sessionId,
        messageID,
        createSessionService(getApiClient()),
      );
    } catch (err) {
      setForkError(ApiError.fromUnknown(err));
    }
  }

  /** Opens the revert confirm dialog for a message (message menu item or
   *  the snapshot chip). Captures the session so a mid-flight session
   *  switch cannot reroute the confirmation. */
  function requestRevert(messageID: string) {
    const sessionId = activeSessionId();
    if (sessionId === null) return;
    setRevertError(null);
    setRevertTarget({ sessionId, messageID });
  }

  /** Runs the confirmed revert (POST /session/{id}/revert); the updated
   *  session replaces the stored one (its revert marker drives the bar and
   *  the graying). Rejections propagate to the dialog's inline error. */
  async function confirmRevert(): Promise<void> {
    const target = revertTarget();
    if (target === null) return;
    await revertSession(
      activeServerId(),
      target.sessionId,
      target.messageID,
      createSessionService(getApiClient()),
    );
  }

  /** Unreverts the session in one click; a failure surfaces in the banner. */
  async function handleUnrevert() {
    const sessionId = activeSessionId();
    if (sessionId === null) return;
    setRevertError(null);
    try {
      await unrevertSession(activeServerId(), sessionId, createSessionService(getApiClient()));
    } catch (err) {
      setRevertError(ApiError.fromUnknown(err));
    }
  }

  /** Opens the FIRST child session of the given session (TASK-M6-07): the
   *  subtask part cannot reference its child directly (no child id in the
   *  1.18.11 schema), so the handler targets the first child in store
   *  order and ignores the click when there is none. */
  function openChildSession(sessionId: string) {
    const st = getServerSessionState(activeServerId());
    for (const id of st.order) {
      if (st.sessions[id]?.parentID === sessionId) {
        setActiveSession(activeServerId(), id);
        return;
      }
    }
  }

  /** Returns to a child session's parent (the task panel's back button):
   *  no-op when the active session is not a child. */
  function backToParentSession() {
    const st = getServerSessionState(activeServerId());
    const id = activeSessionId();
    if (id === null) return;
    const parent = st.sessions[id]?.parentID;
    if (parent !== undefined) setActiveSession(activeServerId(), parent);
  }

  /** Copies via the async Clipboard API with a legacy execCommand fallback
   *  (mirrors the per-file helpers in MessageActions / FileTree). */
  async function copyToClipboard(text: string): Promise<boolean> {
    if (navigator.clipboard !== undefined) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to the legacy path.
      }
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  }

  // Selected-text menu (TASK-M8-03): the window-level contextmenu fires
  // last, so the message/file/session menus (which preventDefault) and any
  // open menu region (the ContextMenu root + backdrop) win; everything else
  // with a non-empty selection opens the text menu. The Menu key reaches
  // the same handler through the browser's contextmenu event.
  createEffect(() => {
    const onWindowContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-context-menu], [data-context-backdrop]") !== null
      ) {
        return;
      }
      const selection = document.getSelection()?.toString() ?? "";
      if (selection.trim() === "") return;
      event.preventDefault();
      setTextMenu({ x: event.clientX, y: event.clientY, selection });
    };
    window.addEventListener("contextmenu", onWindowContextMenu);
    onCleanup(() => window.removeEventListener("contextmenu", onWindowContextMenu));
  });

  /** Selected-text menu items: copy the selection, or quote it into the
   *  composer through the prefill store (the PromptBox applies it with
   *  focus once mounted — queued text survives an unmounted composer). */
  const textMenuItems = createMemo<MenuItem[]>(() => {
    const selection = textMenu()?.selection ?? "";
    return [
      {
        id: "copy",
        label: t("common:copy"),
        onSelect: () => void copyToClipboard(selection),
      },
      {
        id: "quote",
        label: t("desktop:quoteInChat"),
        onSelect: () => prefillComposer(quoteBlock(selection)),
      },
    ];
  });

  async function refresh() {
    try {
      setServers(await listServers());
    } catch {
      // The servers-changed event delivers the list on the next change.
    }
  }

  // Shortcut registry wiring (TASK-M8-01): the actions for every feature
  // this shell owns, dispatched by useShortcuts through the registry. The
  // previous provisional ⌘P/⌘⇧F/⌘D/⌘J hooks and the ⌘1..9 digit switch
  // moved here verbatim (the input guard and the digit range live in the
  // registry now); ⌘K (command palette) joined in TASK-M8-02, and the
  // input locals (⌘Enter, Tab, ↑, Esc) stay inside PromptBox / the sheets.
  useShortcuts({
    activeScope,
    actions: {
      commandPalette: () => setCommandPalette(true),
      newSession: () => void handleNewSession(),
      quickOpen: () => setQuickOpen(true),
      fullTextSearch: () => {
        setMainView("files");
        // Repeated presses cycle between the search panel and the viewer.
        setFilesMode((mode) => (mode === "search" ? "viewer" : "search"));
      },
      sessionDiff: () => {
        if (mainView() === "diff") {
          // From the diff view it cycles: a filtered diff clears the
          // filter, an unfiltered one goes back to the chat view.
          if (diffMessageId() !== undefined) {
            setDiffMessageId(undefined);
          } else {
            setMainView("chat");
          }
          return;
        }
        if (!activeSessionId()) return;
        openDiff();
      },
      toggleTerminal: () => setMainView((view) => (view === "terminal" ? "chat" : "terminal")),
      switchServer: (event) => {
        const target = servers()[Number(event.key) - 1];
        if (!target) return;
        setActiveServer(target.id);
      },
      prevSession: () => stepSession(-1),
      nextSession: () => stepSession(1),
      toggleSidebar: () => setSidebarCollapsed((collapsed) => !collapsed),
      openSettings: () => setSettingsOpen(true),
    },
  });

  // SSE wiring (TASK-M2-03): one subscription per (server, directory)
  // context. The effect re-runs when the active server or its active
  // directory changes, tearing down the old stream and opening a new one
  // for the new context before re-syncing. A version counter rejects
  // stale async rebuilds so rapid switches never leak subscriptions.
  let sse: SubscribeToServerEventsResult | undefined;
  let rebuildVersion = 0;

  async function rebuild(
    serverId: string | null,
    directory: string | undefined,
    version: number,
  ): Promise<void> {
    const previous = sse;
    sse = undefined;
    if (previous) await previous.unsubscribe();
    if (serverId === null || version !== rebuildVersion) return;
    // Drop the previous context's sessions, messages and todos so the new
    // directory's data can never mix with the old one; the re-sync
    // re-applies fresh snapshots right after the stream is up. The active
    // session survives through the session store's restore candidate (armed
    // by setActiveSession, preserved by resetServer) and is re-selected by
    // the restore effect below once the fresh snapshot lands — so neither a
    // rebuild NOR a later server.connected reconnect can leave the chat pane
    // on the "Select a session" placeholder (Bug 2 / Bug 4).
    resetSessions(serverId);
    resetMessages(serverId);
    resetTodos(serverId);
    resetViewer(serverId);
    resetDiffs(serverId);
    resetPermissions(serverId);
    let dir = directory;
    if (dir === undefined) {
      // Context not seeded yet (mount / server switch): resolve the current
      // project so the per-directory stream is opened instead of the global
      // one; the re-sync fills the store from the same lookup.
      try {
        const currentProject = await createProjectService(getApiClient()).current();
        if (version !== rebuildVersion) return;
        dir = currentProject?.worktree;
      } catch {
        // Unreachable server: stay without a directory stream; the next
        // context change rebuilds it.
      }
    }
    const subscription = await subscribeToServerEvents(
      serverId,
      () => getServerProjectState(serverId).current ?? undefined,
    );
    if (version !== rebuildVersion) {
      await subscription.unsubscribe();
      return;
    }
    sse = subscription;
    // Re-sync without blocking the rebuild (the original timing stays intact
    // so the SSE/server.connected wiring does not re-enter the effect). A
    // failed re-sync must not break the stream; the next context change (or
    // a server.connected event) heals the stores.
    subscription.sync().catch(() => undefined);
  }

  createEffect(() => {
    const serverId = registry.activeServerId;
    const directory =
      serverId === null ? undefined : (getServerProjectState(serverId).current ?? undefined);
    const version = ++rebuildVersion;
    void rebuild(serverId, directory, version);
  });

  // Active-session restore (Bug 2 / Bug 4): every context rebuild AND every
  // SSE reconnect (server.connected) calls resetServer, which clears
  // activeSessionId. The session store keeps the last user selection as a
  // restore candidate (armed by setActiveSession, disarmed by deleting that
  // session); whenever the store ends up with no active session, re-select
  // the candidate — but never resurrect a session the user deleted. This
  // covers rebuilds AND reconnects arriving at any time (the previous
  // one-shot restore only ran after the rebuild's own re-sync, so a
  // server.connected landing later left the chat on "Select a session").
  // setActiveSession re-arms the candidate, so a reconnect storm keeps
  // restoring the same session instead of the first restore winning.
  createEffect(() => {
    const serverId = activeServerId();
    if (getServerSessionState(serverId).activeSessionId !== null) return;
    const candidate = takeRestoreCandidate(serverId);
    if (candidate !== null) setActiveSession(serverId, candidate);
  });

  // System notifications (TASK-M8-06): one watcher for the active server,
  // torn down and re-created on server switches (like the SSE stream) so
  // events can never notify for a stale context. The watcher itself
  // applies the prefs + window-focus gate; the facade no-ops outside
  // Tauri. The memo compares by value, so the onMount `setActiveServer`
  // (registry null -> id, same fallback result) never double-mounts.
  const notificationServerId = createMemo(() => activeServerId());
  createEffect(() => {
    const serverId = notificationServerId();
    const disposeNotifications = startNotifications(serverId);
    onCleanup(disposeNotifications);
  });

  // Automatic session titles (settings > config > global "AI generated
  // title"): one watcher for the active server, rebuilt on switches like
  // the notification watcher so a stale context never renames sessions.
  const autoTitleServerId = createMemo(() => activeServerId());
  createEffect(() => {
    const serverId = autoTitleServerId();
    const disposeAutoTitle = startAutoTitler(serverId);
    onCleanup(disposeAutoTitle);
  });

  // Pet state linkage (TASK-M8-08): one watcher for the active server,
  // torn down and re-created on server switches (same memo discipline as
  // the notification watcher) so the pet always reflects the server in
  // focus. The watcher folds session/permission/question stores into the
  // pet state machine and forwards the result + token-rate intensity to
  // the pet window; the facade no-ops outside Tauri.
  const petServerId = createMemo(() => activeServerId());
  createEffect(() => {
    const serverId = petServerId();
    const disposePet = startPetWatcher(serverId);
    onCleanup(disposePet);
  });

  onCleanup(() => {
    rebuildVersion += 1;
    const current = sse;
    sse = undefined;
    if (current) void current.unsubscribe();
  });

  onMount(() => {
    setActiveServer(props.server.id);
    void refresh();
    // Default-workspace onboarding (feat(default-workspace)): the first
    // entry of a server with no workspace history prompts for its default
    // workspace. Marking it shown here means a skipped prompt is remembered
    // (no nagging on every entry); Settings → Servers can change the choice.
    if (!hasWorkspaceHistory(props.server.id) && !wasDefaultWorkspacePrompted(props.server.id)) {
      markDefaultWorkspacePrompted(props.server.id);
      setDefaultWorkspaceOpen(true);
    }
    // Diagnostics capture (TASK-M9-07): the window-level error/warn hooks
    // feed the diagnostics console app-wide (not just while the settings
    // view is open); when the pref is on, captured entries are forwarded
    // to the server via POST /log. Both are torn down on unmount.
    const stopCapture = installLogCapture();
    const stopForwarding = forwardLogsEnabled() ? startLogForwarding() : () => {};
    const stopHealth = subscribeToServerHealth();
    const stopChanged = subscribeToServersChanged((entries) => setServers(entries));
    // Tray & global summon (TASK-M8-05): the tray menu's New session uses
    // the same handler as ⌘N; the global-summon event needs no frontend
    // reaction (Rust shows and focuses the window), the badge sync keeps
    // the tray in step with the pending-permission load, and the persisted
    // desktop prefs are re-applied so close-to-tray and a custom summon
    // accelerator survive restarts.
    const stopTrayNewSession = subscribeToTrayNewSession(() => void handleNewSession());
    const stopGlobalSummon = subscribeToGlobalSummon(() => {
      // The window is shown and focused Rust-side; nothing to do here.
    });
    // Notification clicks (TASK-M8-06): the plugin delivers click events
    // only on iOS/Android — on desktop the notification is fire-and-forget
    // (documented limitation). Focusing the window is all a click needs:
    // the permission/question sheets are global and auto-show from their
    // stores once the window is frontmost.
    const stopNotificationClick = subscribeToNotificationClick(() => void focusWindow());
    const disposeBadgeSync = startTrayBadgeSync();
    void applyDesktopPrefs().catch(() => {
      // IPC rejection at mount: swallow so it never surfaces as an
      // unhandled rejection; the stored prefs stay un-applied until the
      // next run (the Rust defaults remain in effect).
    });
    // Pet companion (TASK-M8-07): show the pet when the pref is not
    // explicitly off (default on). The 🐾 title-bar button and the
    // Desktop settings switch override it any time.
    if (petEnabled()) {
      void showPet().catch(() => {
        // The pet is a best-effort companion: a failed IPC at mount never
        // blocks the workspace.
      });
    }
    // Application auto-update (TASK-M8-09): a background check runs at most
    // once per day (timestamp recorded BEFORE the check so a slow/failing
    // endpoint cannot retry every launch); a found update surfaces as a
    // toast — the Updates settings section owns the install flow. Outside
    // Tauri / without a release published the check resolves null or fails,
    // both silent here.
    if (shouldAutoCheck(loadLastCheck(), Date.now())) {
      recordLastCheck();
      void checkForUpdates()
        .then((found) => {
          if (found !== null) {
            createToast(t("desktop:updateToast", { version: found.version }));
          }
        })
        .catch(() => {
          // Unreachable endpoint (no release published yet): silent.
        });
    }
    onCleanup(() => {
      stopHealth();
      stopChanged();
      stopTrayNewSession();
      stopGlobalSummon();
      stopNotificationClick();
      disposeBadgeSync();
      stopForwarding();
      stopCapture();
      setActiveServer(null);
    });
  });

  const activeServer = (): ServerEntry =>
    servers().find((entry) => entry.id === registry.activeServerId) ?? props.server;

  return (
    <div
      class="flex h-full min-h-0 flex-col bg-bg-base text-fg-primary"
      data-testid="desktop-shell"
      data-active-scope={activeScope()}
    >
      {/* Server update hint (TASK-M8-09): `installation.update-available`
        SSE events mark the SERVER as needing an upgrade — the app cannot
        update it, the banner is informational only; dismissing clears the
        hint for the active server. */}
      <Show when={serverUpdate[activeServerId()]}>
        <div
          data-testid="server-update-banner"
          class="flex shrink-0 items-center gap-2 border-b border-bg-sunken bg-accent-soft px-4 py-2"
        >
          <p
            data-testid="server-update-banner-text"
            class="min-w-0 flex-1 truncate text-xs text-fg-primary"
          >
            {t("desktop:serverUpdateBanner", {
              version: serverUpdate[activeServerId()]?.version,
              running:
                serverUpdate[activeServerId()]?.current !== undefined
                  ? t("desktop:runningVersion", {
                      version: serverUpdate[activeServerId()]?.current,
                    })
                  : "",
            })}
          </p>
          <button
            type="button"
            data-testid="server-update-banner-dismiss"
            aria-label={t("desktop:dismissUpdateHint")}
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-fg-secondary outline-none hover:bg-bg-sunken hover:text-fg-primary"
            onClick={() => clearServerUpdate(activeServerId())}
          >
            ×
          </button>
        </div>
      </Show>
      <div class="flex min-h-0 flex-1">
        <nav
          class="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-bg-sunken bg-bg-elevated py-3"
          data-testid="rail"
        >
          <For each={servers()}>
            {(entry) => {
              const active = () => registry.activeServerId === entry.id;
              const kind = () => healthKind(entry);
              return (
                <button
                  type="button"
                  data-testid={`rail-item-${entry.id}`}
                  data-active={active() ? "true" : "false"}
                  aria-label={t("desktop:switchToServer", { name: entry.name })}
                  title={entry.name}
                  class="outline-none"
                  onClick={() => setActiveServer(entry.id)}
                >
                  <span
                    class={`relative flex h-10 w-10 items-center justify-center rounded-full border bg-bg-sunken text-sm font-medium transition-colors ${
                      active()
                        ? "border-accent text-fg-primary"
                        : "border-transparent text-fg-secondary hover:text-fg-primary"
                    }`}
                  >
                    {entry.name.charAt(0)}
                    <span
                      data-testid="rail-dot"
                      data-status={kind()}
                      class={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-elevated ${dotClass[kind()]}`}
                    />
                  </span>
                </button>
              );
            }}
          </For>
          <button
            type="button"
            data-testid="rail-add"
            aria-label={t("servers:addServer")}
            title={t("servers:addServer")}
            class="mt-2 flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-fg-faint text-lg text-fg-secondary transition-colors hover:text-fg-primary"
            onClick={() => props.onExit()}
          >
            +
          </button>
          {/* The rail lives outside the main-area view switch, so this gear
              keeps settings reachable from chat, files, diff, terminal and
              changes alike (the main-area tab bar has no gear of its own). */}
          <button
            type="button"
            data-testid="rail-settings"
            aria-label={t("desktop:openSettings")}
            title={t("settings:settings")}
            class="mt-auto flex h-10 w-10 items-center justify-center rounded-full border border-bg-sunken text-fg-secondary transition-colors hover:border-fg-faint hover:text-fg-primary"
            onClick={() => setSettingsOpen(true)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </nav>

        <aside
          data-testid="sidebar"
          data-collapsed={sidebarCollapsed() ? "true" : "false"}
          class={`w-64 shrink-0 flex-col border-r border-bg-sunken bg-bg-elevated ${
            sidebarCollapsed() ? "hidden" : "flex"
          }`}
        >
          <header class="flex items-center justify-between gap-2 border-b border-bg-sunken px-4 py-3">
            <h1 data-testid="sidebar-server-name" class="truncate text-sm font-semibold">
              {activeServer().name}
            </h1>
            <button
              type="button"
              data-testid="back-to-servers"
              class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary hover:text-fg-primary"
              onClick={() => props.onExit()}
            >
              Back to servers
            </button>
          </header>
          <div
            role="tablist"
            aria-label={t("desktop:sidebarView")}
            class="flex shrink-0 gap-1 border-b border-bg-sunken px-3 py-2"
          >
            <button
              type="button"
              role="tab"
              data-testid="sidebar-view-sessions"
              aria-selected={sidebarView() === "sessions" ? "true" : "false"}
              class={`flex-1 rounded-md px-3 py-1 text-xs outline-none transition-colors ${
                sidebarView() === "sessions"
                  ? "bg-accent-soft text-fg-primary"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
              onClick={() => setSidebarView("sessions")}
            >
              {t("sessions:workspaces")}
            </button>
            <button
              type="button"
              role="tab"
              data-testid="sidebar-view-files"
              aria-selected={sidebarView() === "files" ? "true" : "false"}
              class={`flex-1 rounded-md px-3 py-1 text-xs outline-none transition-colors ${
                sidebarView() === "files"
                  ? "bg-accent-soft text-fg-primary"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
              onClick={() => setSidebarView("files")}
            >
              Files
            </button>
          </div>
          <Show
            when={sidebarView() === "sessions"}
            fallback={
              <FileTree
                serverId={activeServerId()}
                directory={filesDirectory()}
                onOpenFile={(path) => {
                  openTab(activeServerId(), path);
                  setMainView("files");
                }}
                onReference={(path) => prefillComposer(`@${path}`)}
              />
            }
          >
            {/* The workspace-tree focus wrapper drives the registry's "list"
              scope (TASK-M8-01): keyboard focus on a row scopes list-only
              shortcuts; leaving the list restores the global scope. */}
            <div
              class="flex min-h-0 flex-1 flex-col"
              onFocusIn={() => setActiveScope("list")}
              onFocusOut={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setActiveScope("global");
                }
              }}
            >
              <WorkspaceTree
                serverId={activeServerId()}
                onSelectSession={() => setMainView("chat")}
                onViewFolder={(directory) => {
                  // View folder: switch the session context to the picked
                  // workspace, point the sidebar file tree at it and show
                  // the Files view. setCurrent is REQUIRED — every file
                  // request (subtree expansion, file content, git status)
                  // is routed by the active directory, so browsing a folder
                  // whose directory differs from the session context makes
                  // the server answer for the WRONG workspace (or error).
                  // The rebuild this triggers drops the old files store,
                  // but the FileTree's own loadRoot (async) lands after the
                  // synchronous reset, so the picked directory still loads.
                  setCurrent(activeServerId(), directory);
                  pushRecentProject(activeServerId(), directory);
                  setFilesDirectory(directory);
                  setSidebarView("files");
                  setMainView("files");
                }}
              />
            </div>
          </Show>
        </aside>

        <main class="flex min-w-0 flex-1 flex-col">
          <Show
            when={mainView() === "diff" || mainView() === "changes" || mainView() === "terminal"}
            fallback={
              <>
                {/* TASK-M9-08: the main-pane switcher mixes view tabs with
                  action buttons (search/changes/terminal/settings), so it
                  is NOT a tablist (axe aria-required-children); the active
                  view uses aria-current instead of aria-selected. */}
                <div class="flex shrink-0 items-center gap-1 border-b border-bg-sunken px-3 py-2">
                  {/* Segmented view switch: compact auto-width control (the
                    previous flex-1 tabs stretched into full-width pills). */}
                  <div class="flex gap-0.5 rounded-lg bg-bg-sunken/60 p-0.5">
                    <button
                      type="button"
                      data-testid="main-tab-chat"
                      aria-current={mainView() === "chat" ? "true" : undefined}
                      class={`rounded-md px-3 py-1 text-xs outline-none transition-colors ${
                        mainView() === "chat"
                          ? "bg-accent-soft text-fg-primary"
                          : "text-fg-secondary hover:text-fg-primary"
                      }`}
                      onClick={() => setMainView("chat")}
                    >
                      Chat
                    </button>
                    <button
                      type="button"
                      data-testid="main-tab-files"
                      aria-current={mainView() === "files" ? "true" : undefined}
                      class={`rounded-md px-3 py-1 text-xs outline-none transition-colors ${
                        mainView() === "files"
                          ? "bg-accent-soft text-fg-primary"
                          : "text-fg-secondary hover:text-fg-primary"
                      }`}
                      onClick={() => setMainView("files")}
                    >
                      Files
                    </button>
                  </div>
                  <div class="ml-auto flex items-center gap-1">
                    <Show when={mainView() === "files"}>
                      <button
                        type="button"
                        data-testid="files-search-toggle"
                        aria-pressed={filesMode() === "search" ? "true" : "false"}
                        aria-label={t("desktop:toggleSearch")}
                        title={t("desktop:searchHint")}
                        class={`shrink-0 rounded-md p-1 outline-none transition-colors ${
                          filesMode() === "search"
                            ? "text-accent"
                            : "text-fg-secondary hover:text-fg-primary"
                        }`}
                        onClick={() =>
                          setFilesMode((mode) => (mode === "viewer" ? "search" : "viewer"))
                        }
                      >
                        <SearchIcon />
                      </button>
                      <button
                        type="button"
                        data-testid="changes-toggle"
                        aria-label={t("desktop:openVcs")}
                        title={t("desktop:vcsHint")}
                        class="shrink-0 rounded-md p-1 text-fg-secondary outline-none transition-colors hover:text-fg-primary"
                        onClick={() => setMainView("changes")}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.6"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="h-4 w-4"
                          aria-hidden="true"
                        >
                          <circle cx="6" cy="6" r="2.4" />
                          <circle cx="6" cy="18" r="2.4" />
                          <circle cx="18" cy="8" r="2.4" />
                          <path d="M6 8.4v7.2M6 8.4a5 5 0 0 0 5 5h5" />
                        </svg>
                      </button>
                    </Show>
                    <button
                      type="button"
                      data-testid="terminal-toggle"
                      aria-label={t("desktop:openTerminal")}
                      title={t("desktop:terminalHint")}
                      class="shrink-0 rounded-md p-1 text-fg-secondary outline-none transition-colors hover:text-fg-primary"
                      onClick={() => setMainView("terminal")}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="h-4 w-4"
                        aria-hidden="true"
                      >
                        <path d="m4 7 5 5-5 5M12 17h8" />
                      </svg>
                    </button>
                  </div>
                </div>
                <Show
                  when={mainView() === "chat"}
                  fallback={
                    <div class="flex h-full min-h-0 flex-col">
                      <div
                        data-testid="files-viewer-pane"
                        data-visible={filesMode() === "viewer" ? "true" : "false"}
                        class={filesMode() === "viewer" ? "min-h-0 flex-1" : "hidden"}
                      >
                        <FileViewer
                          serverId={activeServerId()}
                          visible={filesMode() === "viewer"}
                        />
                      </div>
                      <div
                        data-testid="files-search-pane"
                        data-visible={filesMode() === "search" ? "true" : "false"}
                        class={filesMode() === "search" ? "min-h-0 flex-1" : "hidden"}
                      >
                        <SearchPanel
                          serverId={activeServerId()}
                          onOpenHit={() => setFilesMode("viewer")}
                        />
                      </div>
                    </div>
                  }
                >
                  <Show
                    when={activeSessionId()}
                    fallback={
                      <div class="flex flex-1 items-center justify-center p-4">
                        <p class="text-sm text-fg-secondary">Select a session — M2</p>
                      </div>
                    }
                  >
                    <header class="flex shrink-0 items-center justify-between gap-2 border-b border-bg-sunken px-4 py-1.5">
                      <h2
                        data-testid="chat-session-title"
                        class="min-w-0 truncate text-xs font-medium text-fg-secondary"
                      >
                        {titleOf(activeServerId(), activeSessionId() as string)}
                      </h2>
                      <div
                        class="flex shrink-0 items-center gap-0.5"
                        aria-label={t("desktop:chatHeaderActions")}
                      >
                        <button
                          type="button"
                          data-testid="session-share-toggle"
                          data-shared={
                            sessionOf(activeServerId(), activeSessionId() as string)?.share !==
                            undefined
                              ? "true"
                              : "false"
                          }
                          aria-label={t("desktop:shareSession")}
                          title={
                            sessionOf(activeServerId(), activeSessionId() as string)?.share !==
                            undefined
                              ? t("desktop:sharedHint")
                              : t("desktop:shareSession")
                          }
                          class={`rounded-md p-1.5 outline-none transition-colors ${
                            sessionOf(activeServerId(), activeSessionId() as string)?.share !==
                            undefined
                              ? "text-accent"
                              : "text-fg-secondary hover:text-fg-primary"
                          }`}
                          onClick={() => {
                            const target = sessionOf(activeServerId(), activeSessionId() as string);
                            if (target !== undefined) setShareTarget(target);
                          }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.6"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            class="h-4 w-4"
                            aria-hidden="true"
                          >
                            <circle cx="18" cy="5" r="2.4" />
                            <circle cx="6" cy="12" r="2.4" />
                            <circle cx="18" cy="19" r="2.4" />
                            <path d="m8.6 10.6 6.8-4.2M8.6 13.4l6.8 4.2" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          data-testid="todo-toggle"
                          aria-label={t("desktop:toggleTodo")}
                          title={t("desktop:toggleTodo")}
                          class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-2.5 py-1 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
                          onClick={() => setTaskExpandToken((token) => token + 1)}
                        >
                          {t("desktop:todos")}
                        </button>
                      </div>
                    </header>
                    <MessageList
                      serverId={activeServerId()}
                      sessionId={activeSessionId() as string}
                      onViewDiff={openDiff}
                      onFork={(messageID) => {
                        const id = activeSessionId();
                        if (id !== null) void handleFork(id, messageID);
                      }}
                      onRevert={requestRevert}
                      onUnrevert={() => void handleUnrevert()}
                      onOpenChild={openChildSession}
                    />
                    <SessionErrorBanner
                      serverId={activeServerId()}
                      sessionId={activeSessionId() as string}
                    />
                    <div class="px-4 pb-2">
                      <ErrorBanner error={forkError()} onDismiss={() => setForkError(null)} />
                    </div>
                    <div class="px-4 pb-2">
                      <ErrorBanner error={revertError()} onDismiss={() => setRevertError(null)} />
                    </div>
                    {/* The composer focus wrapper drives the registry's
                      "chat" scope (TASK-M8-01): while the input (or one of
                      its toolbar controls) is focused, chat-scoped
                      shortcuts dispatch; leaving the composer restores the
                      global scope. */}
                    <div
                      onFocusIn={() => setActiveScope("chat")}
                      onFocusOut={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setActiveScope("global");
                        }
                      }}
                    >
                      <div class="mx-auto w-full max-w-6xl">
                        <TaskPanel
                          serverId={activeServerId()}
                          sessionId={activeSessionId() as string}
                          onSelectSession={(sessionId) =>
                            setActiveSession(activeServerId(), sessionId)
                          }
                          onBackToParent={backToParentSession}
                          expandToken={taskExpandToken()}
                        />
                        <PromptBox
                          serverId={activeServerId()}
                          sessionId={activeSessionId() as string}
                        />
                      </div>
                    </div>
                  </Show>
                </Show>
              </>
            }
          >
            {/* Diff view (TASK-M4-07): its own header (back to chat + message
              filter chip) replaces the Chat|Files tab bar while open. The
              Changes view (TASK-M4-08) sits beside it the same way, the
              Settings view (TASK-M5-06) is the third sibling (the gear
              button's Back header returns to chat; M9-04 expands it), and
              the Terminal view (TASK-M6-02) is the fourth (⌘/Ctrl+J or the
              tab-bar icon; its Back returns to chat). */}
            <Show
              when={mainView() === "terminal"}
              fallback={
                <Show
                  when={mainView() === "changes"}
                  fallback={
                    <>
                      <header class="flex shrink-0 items-center gap-2 border-b border-bg-sunken px-4 py-2">
                        <button
                          type="button"
                          data-testid="diff-back"
                          class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
                          onClick={() => setMainView("chat")}
                        >
                          ← {t("common:back")}
                        </button>
                        <h2 class="shrink-0 text-sm font-semibold">{t("desktop:sessionDiff")}</h2>
                        <Show when={diffMessageId() !== undefined}>
                          <span
                            data-testid="diff-message-filter"
                            class="flex shrink-0 items-center gap-1 rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 text-xs"
                          >
                            Message {diffMessageId()}
                            <button
                              type="button"
                              data-testid="diff-filter-clear"
                              aria-label={t("desktop:showWholeDiff")}
                              class="flex h-4 w-4 items-center justify-center rounded-full text-fg-secondary outline-none hover:bg-bg-sunken hover:text-fg-primary"
                              onClick={() => setDiffMessageId(undefined)}
                            >
                              ×
                            </button>
                          </span>
                        </Show>
                      </header>
                      <Show
                        when={activeSessionId()}
                        fallback={
                          <div class="flex flex-1 items-center justify-center p-4">
                            <p class="text-sm text-fg-secondary">Select a session — M2</p>
                          </div>
                        }
                      >
                        <DiffView
                          serverId={activeServerId()}
                          sessionId={activeSessionId() as string}
                          messageId={diffMessageId()}
                        />
                      </Show>
                    </>
                  }
                >
                  {/* Changes view (TASK-M4-08): the VCS panel with its own back
                    header returning to the Files view it was opened from. */}
                  <header class="flex shrink-0 items-center gap-2 border-b border-bg-sunken px-4 py-2">
                    <button
                      type="button"
                      data-testid="changes-back"
                      class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
                      onClick={() => setMainView("files")}
                    >
                      ← {t("common:back")}
                    </button>
                    <h2 class="shrink-0 text-sm font-semibold">{t("desktop:changes")}</h2>
                  </header>
                  <VcsPanel serverId={activeServerId()} />
                </Show>
              }
            >
              {/* Terminal view (TASK-M6-02): the multi-tab PTY panel with
                its own Back header returning to the chat view. */}
              <header class="flex shrink-0 items-center gap-2 border-b border-bg-sunken px-4 py-2">
                <button
                  type="button"
                  data-testid="terminal-back"
                  class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
                  onClick={() => setMainView("chat")}
                >
                  ← {t("common:back")}
                </button>
                <h2 class="shrink-0 text-sm font-semibold">{t("desktop:terminal")}</h2>
              </header>
              <Suspense fallback={<div class="flex flex-1 items-center justify-center p-4" />}>
                <TerminalPanel serverId={activeServerId()} />
              </Suspense>
            </Show>
          </Show>
        </main>
      </div>

      {/* Status bar (TASK-M4-08): minimal bottom bar with the branch chip,
          reactive to the vcs store (M9-07 extends it with the LSP count,
          the enabled formatter names and the active session's tokens+cost).
          IA-22: aria-label for screen readers; contrast ≥4.5:1 via
          --fg-secondary (#9aa3b2) on --bg-elevated (#161a22) ≈ 6.4:1. */}
      <footer
        data-testid="status-bar"
        aria-label={t("desktop:statusBar")}
        role="status"
        class="flex h-7 shrink-0 items-center gap-3 border-t border-bg-sunken bg-bg-elevated px-3"
      >
        <StatusBarBranch serverId={activeServerId()} />
        <StatusBarLsp serverId={activeServerId()} />
        <StatusBarFormatter serverId={activeServerId()} />
        <StatusBarUsage serverId={activeServerId()} />
      </footer>

      {/* Quick open (TASK-M4-04): ⌘/Ctrl+P opens the file search dialog; a
          picked file jumps Main to Files like a sidebar tree click. */}
      <QuickOpen
        serverId={activeServerId()}
        open={quickOpen()}
        onClose={() => setQuickOpen(false)}
        onOpenFile={() => setMainView("files")}
      />

      {/* Command palette (TASK-M8-02): ⌘/Ctrl+K aggregates sessions /
          files / symbols / commands / settings / servers. The palette
          owns the file/symbol store side effects (viewer tab + active
          line + recent memory, like QuickOpen) and delegates the shell
          state transitions to these handlers — the same ones the ⌘
          shortcuts use, so palette picks and shortcuts stay equivalent. */}
      <CommandPalette
        serverId={activeServerId()}
        servers={servers()}
        open={commandPalette()}
        hasActiveSession={activeSessionId() !== null}
        onClose={() => setCommandPalette(false)}
        actions={{
          onNewSession: () => void handleNewSession(),
          onOpenSettings: () => setSettingsOpen(true),
          onToggleSidebar: () => setSidebarCollapsed((collapsed) => !collapsed),
          onOpenTerminal: () => setMainView("terminal"),
          onOpenDiff: () => {
            if (activeSessionId()) openDiff();
          },
          onSwitchServer: (id) => setActiveServer(id),
          onOpenSession: (id) => setActiveSession(activeServerId(), id),
          onRunCommand: (name) => {
            const sessionId = activeSessionId();
            if (sessionId === null) return;
            void createCommandService(getApiClient())
              .run(sessionId, { command: name, arguments: "" })
              .catch(() => {
                // A failed run surfaces as a global toast (the composer's
                // slash path restores its input text instead).
                createToast(t("desktop:commandFailed"), "error");
              });
          },
          onOpenFile: () => setMainView("files"),
          onOpenSymbol: () => setMainView("files"),
        }}
      />

      {/* Permission sheet (TASK-M5-01): global overlay for the active
          server's pending permission queue; renders only while a request
          is waiting (the mobile bottom-sheet variant lands in M7). */}
      <PermissionSheet serverId={activeServerId()} variant="overlay" />

      {/* Question sheet (TASK-M5-02): global overlay for the active
          server's pending question queue; renders only while a question
          is waiting (the mobile bottom-sheet variant lands in M7). */}
      <QuestionSheet serverId={activeServerId()} variant="overlay" />

      {/* Revert confirm (TASK-M6-04): one dialog for every entry point —
          the message menu's "Revert to here" and the snapshot chip. */}
      <Show when={revertTarget() !== null}>
        <RevertMessageDialog
          messageID={revertTarget()!.messageID}
          onConfirm={confirmRevert}
          onClose={() => setRevertTarget(null)}
        />
      </Show>

      {/* Share dialog (TASK-M6-05): opened from the chat header share icon;
          the row menu opens its own instance inside WorkspaceTree. */}
      <Show when={shareTarget()} keyed>
        {(target) => (
          <ShareSessionDialog
            serverId={activeServerId()}
            session={target}
            onClose={() => setShareTarget(null)}
          />
        )}
      </Show>

      {/* Toast host (TASK-M6-06): global result feedback (summarize/init
          successes), auto-dismissed by the toast store. */}
      <Toasts />

      {/* Selected-text context menu (TASK-M8-03): Copy / Quote in chat,
          opened by the window-level contextmenu handler above. */}
      <Show when={textMenu() !== null}>
        <ContextMenu
          testId="text-menu"
          label={t("desktop:selectionActions")}
          x={textMenu()!.x}
          y={textMenu()!.y}
          items={textMenuItems()}
          onClose={() => setTextMenu(null)}
        />
      </Show>

      {/* Settings dialog (TASK-UI-01): settings floats above the active
          view as a modal (gear button / command palette / ⌘,). The dialog
          is mounted after the other overlays so it sits above them. */}
      <Show when={settingsOpen()}>
        <SettingsDialog serverId={activeServerId()} onClose={() => setSettingsOpen(false)} />
      </Show>

      {/* Default-workspace onboarding (feat(default-workspace)): the first
          time a server with no workspace history is entered, prompt for its
          default workspace before landing on the main page. Skipping defers
          the choice (Settings → Servers or the sidebar can set it later). */}
      <Show when={defaultWorkspaceOpen()}>
        <DefaultWorkspaceDialog
          serverId={props.server.id}
          onClose={() => setDefaultWorkspaceOpen(false)}
        />
      </Show>
    </div>
  );
};

export default DesktopShell;
