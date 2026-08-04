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
// M9-07 extends the bar with LSP/MCP/tokens). TASK-M6-02 adds the
// terminal view (a terminal icon in the Chat|Files tab bar or the
// provisional ⌘/Ctrl+J hook opens it; its own Back header returns to
// chat, like the settings view).
// This shell owns the per-directory SSE subscription and rebuilds
// it whenever the active server or the active directory changes,
// re-syncing the stores so sessions and messages never mix across contexts.

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Component } from "solid-js";
import { subscribeToServersChanged } from "../../services/events";
import { listServers } from "../../services/servers";
import type { ServerEntry } from "../../services/servers";
import { getApiClient } from "../../services/client";
import { ApiError } from "../../services/errors";
import ErrorBanner from "../../components/ErrorBanner.js";
import Toasts from "../../components/Toast.js";
import { createProjectService } from "../../services/project";
import { createSessionService, type Session } from "../../services/session";
import { createVcsService } from "../../services/vcs";
import {
  forkSession,
  revertSession,
  unrevertSession,
} from "../../features/sessions/sessionActions.js";
import RevertMessageDialog from "../../features/messages/RevertMessageDialog";
import ShareSessionDialog from "../../features/sessions/ShareSessionDialog";
import { connections, subscribeToServerHealth } from "../../stores/connection";
import { registry, setActiveServer } from "../../stores/registry";
import { getServerProjectState } from "../../stores/project";
import { getServerSessionState, resetServer as resetSessions } from "../../stores/session";
import { resetServer as resetMessages } from "../../stores/messages";
import { resetServer as resetTodos } from "../../stores/todos";
import { openTab, resetServer as resetViewer } from "../../stores/viewer";
import { subscribeToServerEvents, type SubscribeToServerEventsResult } from "../../stores/events";
import ProjectSwitcher from "../../features/sessions/ProjectSwitcher";
import PromptBox from "../../features/sessions/PromptBox";
import SessionErrorBanner from "../../features/sessions/SessionErrorBanner";
import SessionList from "../../features/sessions/SessionList";
import TodoPanel from "../../features/sessions/TodoPanel";
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
import PermissionSheet from "../../features/permissions/PermissionSheet";
import QuestionSheet from "../../features/questions/QuestionSheet";
import SettingsPage from "../../features/settings/SettingsPage";
import TerminalPanel from "../../features/terminal/TerminalPanel";

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
        title="Current branch"
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

const DesktopShell: Component<DesktopShellProps> = (props) => {
  const [servers, setServers] = createSignal<ServerEntry[]>([]);
  // Main-pane placeholder target: the store's active session id, so both
  // row selection and the "New session" flow update it. The per-server
  // bucket is wiped on every context rebuild, so the placeholder can never
  // show a session from another server's context.
  const activeServerId = () => registry.activeServerId ?? props.server.id;
  const activeSessionId = createMemo(() => getServerSessionState(activeServerId()).activeSessionId);
  // Todo drawer (TASK-M3-07): local open state; closes on Esc or backdrop.
  const [todosOpen, setTodosOpen] = createSignal(false);
  const closeTodos = () => setTodosOpen(false);
  // Sidebar view switch (TASK-M4-02): Sessions list or the Files tree.
  const [sidebarView, setSidebarView] = createSignal<"sessions" | "files">("sessions");
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
  const [mainView, setMainView] = createSignal<
    "chat" | "files" | "diff" | "changes" | "settings" | "terminal"
  >("chat");
  // Diff message filter (TASK-M4-07): set when opened from a message's
  // "View diff"; the diff header's chip clears it back to the whole
  // session's diff.
  const [diffMessageId, setDiffMessageId] = createSignal<string | undefined>(undefined);
  // Files pane mode (TASK-M4-05): the tabbed viewer or the full-text
  // search panel. Both stay mounted (hidden via CSS) so search results
  // survive the round trip when a hit switches back to the viewer.
  const [filesMode, setFilesMode] = createSignal<"viewer" | "search">("viewer");
  // Quick open dialog (TASK-M4-04): toggled by the provisional ⌘/Ctrl+P
  // hook below; M8 moves the shortcut into the command-palette registry.
  const [quickOpen, setQuickOpen] = createSignal(false);
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

  /** Opens the diff view, optionally filtered to one message. */
  function openDiff(messageId?: string) {
    setDiffMessageId(messageId);
    setMainView("diff");
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

  createEffect(() => {
    if (!todosOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTodos();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  async function refresh() {
    try {
      setServers(await listServers());
    } catch {
      // The servers-changed event delivers the list on the next change.
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === "p") {
      // Provisional ⌘/Ctrl+P hook for QuickOpen (TASK-M4-04); M8 moves it
      // into the command-palette registry. Typing in a text control keeps
      // the default behavior (the dialog's own input is guarded the same
      // way, so ⌘P inside the open dialog is a no-op).
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      event.preventDefault();
      setQuickOpen(true);
      return;
    }
    if (event.key.toLowerCase() === "f" && event.shiftKey) {
      // Provisional ⌘/Ctrl+⇧F hook for the full-text search panel
      // (TASK-M4-05); M8 moves it into the command-palette registry.
      // Guarded like ⌘P while typing in text controls.
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      event.preventDefault();
      setMainView("files");
      // Repeated presses cycle between the search panel and the viewer.
      setFilesMode((mode) => (mode === "search" ? "viewer" : "search"));
      return;
    }
    if (event.key.toLowerCase() === "d") {
      // Provisional ⌘/Ctrl+D hook for the session diff view (TASK-M4-07);
      // M8 moves it into the command-palette registry. Guarded like ⌘P
      // while typing in text controls. From the diff view it cycles: a
      // filtered diff clears the filter, an unfiltered one goes back to
      // the chat view.
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      event.preventDefault();
      if (mainView() === "diff") {
        if (diffMessageId() !== undefined) {
          setDiffMessageId(undefined);
        } else {
          setMainView("chat");
        }
        return;
      }
      if (!activeSessionId()) return;
      openDiff();
      return;
    }
    if (event.key.toLowerCase() === "j") {
      // Provisional ⌘/Ctrl+J hook for the terminal panel (TASK-M6-02);
      // M8 moves it into the command-palette registry. Guarded like ⌘P
      // while typing in text controls; a second press toggles back to
      // the chat view.
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      event.preventDefault();
      setMainView((view) => (view === "terminal" ? "chat" : "terminal"));
      return;
    }
    if (!/^[1-9]$/.test(event.key)) return;
    const target = servers()[Number(event.key) - 1];
    if (!target) return;
    event.preventDefault();
    setActiveServer(target.id);
  }

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
    // re-applies fresh snapshots right after the stream is up.
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
    void subscription.sync().catch(() => {
      // A failed re-sync must not break the stream; the next context
      // change (or a server.connected event) heals the stores.
    });
  }

  createEffect(() => {
    const serverId = registry.activeServerId;
    const directory =
      serverId === null ? undefined : (getServerProjectState(serverId).current ?? undefined);
    const version = ++rebuildVersion;
    void rebuild(serverId, directory, version);
  });

  onCleanup(() => {
    rebuildVersion += 1;
    const current = sse;
    sse = undefined;
    if (current) void current.unsubscribe();
  });

  onMount(() => {
    setActiveServer(props.server.id);
    window.addEventListener("keydown", onKeyDown);
    void refresh();
    const stopHealth = subscribeToServerHealth();
    const stopChanged = subscribeToServersChanged((entries) => setServers(entries));
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      stopHealth();
      stopChanged();
      setActiveServer(null);
    });
  });

  const activeServer = (): ServerEntry =>
    servers().find((entry) => entry.id === registry.activeServerId) ?? props.server;

  return (
    <div
      class="flex h-screen min-h-0 flex-col bg-bg-base text-fg-primary"
      data-testid="desktop-shell"
    >
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
                  aria-label={`Switch to ${entry.name}`}
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
            aria-label="Add server"
            title="Add server"
            class="mt-2 flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-fg-faint text-lg text-fg-secondary transition-colors hover:text-fg-primary"
            onClick={() => props.onExit()}
          >
            +
          </button>
        </nav>

        <aside class="flex w-64 shrink-0 flex-col border-r border-bg-sunken bg-bg-elevated">
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
            aria-label="Sidebar view"
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
              Sessions
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
          <ProjectSwitcher serverId={activeServerId()} />
          <Show
            when={sidebarView() === "sessions"}
            fallback={
              <FileTree
                serverId={activeServerId()}
                onOpenFile={(path) => {
                  openTab(activeServerId(), path);
                  setMainView("files");
                }}
              />
            }
          >
            <SessionList serverId={activeServerId()} onSelect={() => undefined} />
          </Show>
        </aside>

        <main class="flex min-w-0 flex-1 flex-col">
          <Show
            when={
              mainView() === "diff" ||
              mainView() === "changes" ||
              mainView() === "settings" ||
              mainView() === "terminal"
            }
            fallback={
              <>
                <div
                  role="tablist"
                  aria-label="Main view"
                  class="flex shrink-0 gap-1 border-b border-bg-sunken px-3 py-2"
                >
                  <button
                    type="button"
                    role="tab"
                    data-testid="main-tab-chat"
                    aria-selected={mainView() === "chat" ? "true" : "false"}
                    class={`flex-1 rounded-md px-3 py-1 text-xs outline-none transition-colors ${
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
                    role="tab"
                    data-testid="main-tab-files"
                    aria-selected={mainView() === "files" ? "true" : "false"}
                    class={`flex-1 rounded-md px-3 py-1 text-xs outline-none transition-colors ${
                      mainView() === "files"
                        ? "bg-accent-soft text-fg-primary"
                        : "text-fg-secondary hover:text-fg-primary"
                    }`}
                    onClick={() => setMainView("files")}
                  >
                    Files
                  </button>
                  <Show when={mainView() === "files"}>
                    <button
                      type="button"
                      data-testid="files-search-toggle"
                      aria-pressed={filesMode() === "search" ? "true" : "false"}
                      aria-label="Toggle full-text search"
                      title="Full-text search (⌘⇧F)"
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
                      aria-label="Open version control changes"
                      title="VCS changes"
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
                    aria-label="Open terminal"
                    title="Terminal (⌘J)"
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
                  <button
                    type="button"
                    data-testid="settings-toggle"
                    aria-label="Open settings"
                    title="Settings"
                    class="shrink-0 rounded-md p-1 text-fg-secondary outline-none transition-colors hover:text-fg-primary"
                    onClick={() => setMainView("settings")}
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
                      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
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
                    <header class="flex shrink-0 items-center justify-between gap-2 border-b border-bg-sunken px-4 py-2">
                      <h2
                        data-testid="chat-session-title"
                        class="min-w-0 truncate text-sm font-semibold"
                      >
                        {titleOf(activeServerId(), activeSessionId() as string)}
                      </h2>
                      <div class="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          data-testid="session-share-toggle"
                          data-shared={
                            sessionOf(activeServerId(), activeSessionId() as string)?.share !==
                            undefined
                              ? "true"
                              : "false"
                          }
                          aria-label="Share session"
                          title={
                            sessionOf(activeServerId(), activeSessionId() as string)?.share !==
                            undefined
                              ? "Shared — open the share dialog"
                              : "Share session"
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
                          aria-pressed={todosOpen() ? "true" : "false"}
                          aria-label="Toggle todo panel"
                          class={`shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                            todosOpen()
                              ? "border-accent text-accent"
                              : "border-bg-sunken bg-bg-sunken text-fg-secondary hover:text-fg-primary"
                          }`}
                          onClick={() => setTodosOpen((open) => !open)}
                        >
                          Todos
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
                    <PromptBox
                      serverId={activeServerId()}
                      sessionId={activeSessionId() as string}
                    />
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
                      <Show
                        when={mainView() === "settings"}
                        fallback={
                          <>
                            <header class="flex shrink-0 items-center gap-2 border-b border-bg-sunken px-4 py-2">
                              <button
                                type="button"
                                data-testid="diff-back"
                                class="shrink-0 rounded-md border border-bg-sunken bg-bg-sunken px-3 py-1 text-xs text-fg-secondary outline-none hover:border-fg-faint hover:text-fg-primary"
                                onClick={() => setMainView("chat")}
                              >
                                ← Back
                              </button>
                              <h2 class="shrink-0 text-sm font-semibold">Session diff</h2>
                              <Show when={diffMessageId() !== undefined}>
                                <span
                                  data-testid="diff-message-filter"
                                  class="flex shrink-0 items-center gap-1 rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 text-xs"
                                >
                                  Message {diffMessageId()}
                                  <button
                                    type="button"
                                    data-testid="diff-filter-clear"
                                    aria-label="Show the whole session diff"
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
                        {/* Settings view (TASK-M5-06): the gear button's own Back
                          header returns to the chat view; the page hosts the
                          provider API-key section (M9-04 expands the sections). */}
                        <SettingsPage
                          serverId={activeServerId()}
                          onBack={() => setMainView("chat")}
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
                      ← Back
                    </button>
                    <h2 class="shrink-0 text-sm font-semibold">Changes</h2>
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
                  ← Back
                </button>
                <h2 class="shrink-0 text-sm font-semibold">Terminal</h2>
              </header>
              <TerminalPanel serverId={activeServerId()} />
            </Show>
          </Show>
        </main>
      </div>

      {/* Status bar (TASK-M4-08): minimal bottom bar with the branch chip,
          reactive to the vcs store (M9-07 extends it with LSP/MCP/tokens). */}
      <footer
        data-testid="status-bar"
        class="flex h-7 shrink-0 items-center gap-3 border-t border-bg-sunken bg-bg-elevated px-3"
      >
        <StatusBarBranch serverId={activeServerId()} />
      </footer>

      {/* Todo drawer (TASK-M3-07): fixed right-side overlay panel with a
          backdrop; Esc and backdrop clicks close it (mobile bottom sheet
          lands in M7). */}
      <Show when={todosOpen() && activeSessionId()}>
        <div
          data-testid="todo-drawer-backdrop"
          class="fixed inset-0 z-40 bg-black/40"
          onClick={closeTodos}
        />
        <aside
          data-testid="todo-drawer"
          class="fixed right-0 top-0 z-50 flex h-full w-[280px] flex-col border-l border-bg-sunken bg-bg-elevated shadow-lg"
        >
          <header class="flex shrink-0 items-center justify-between border-b border-bg-sunken px-4 py-3">
            <h2 class="text-sm font-semibold">Todos</h2>
            <button
              type="button"
              data-testid="todo-drawer-close"
              aria-label="Close todo panel"
              class="flex h-6 w-6 items-center justify-center rounded-md text-fg-secondary hover:bg-bg-sunken hover:text-fg-primary"
              onClick={closeTodos}
            >
              ✕
            </button>
          </header>
          <TodoPanel serverId={activeServerId()} sessionId={activeSessionId() as string} />
        </aside>
      </Show>

      {/* Quick open (TASK-M4-04): ⌘/Ctrl+P opens the file search dialog; a
          picked file jumps Main to Files like a sidebar tree click. */}
      <QuickOpen
        serverId={activeServerId()}
        open={quickOpen()}
        onClose={() => setQuickOpen(false)}
        onOpenFile={() => setMainView("files")}
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
          the row menu opens its own instance inside SessionList. */}
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
    </div>
  );
};

export default DesktopShell;
