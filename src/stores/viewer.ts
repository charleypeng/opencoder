// Viewer store (TASK-M4-03): per-server open file tabs for the file viewer
// (editor-style multi-tab management). Tabs are plain UI state — the
// content cache lives in FileViewer itself — and each server keeps its own
// ordered tab list with a single active path. Opening an already-open file
// only activates its existing tab; closing the active tab activates the
// left neighbor (or the tab that slid into the closed position).

import { createStore, produce } from "solid-js/store";

export interface ViewerTab {
  /** Workspace path (the GET /file/content `path` parameter). */
  path: string;
  /** Display name (basename of the path unless an explicit name wins). */
  name: string;
  /** Reserved for edit flows; the viewer is read-only today. */
  dirty?: boolean;
}

export interface ViewerServerState {
  /** Open tabs in opening order. */
  tabs: ViewerTab[];
  /** Currently viewed tab path; null while no tab is open. */
  activePath: string | null;
  /** Pending hit-line target (TASK-M4-05): set by the search panel before
   *  switching to the viewer; FileViewer scrolls the line into view,
   *  flashes it briefly, then clears the target. */
  activeLine: { path: string; line: number } | null;
}

export type ViewerMap = Record<string, ViewerServerState>;

const [viewer, setViewer] = createStore<ViewerMap>({});

/** Reactive per-server viewer state (bucket absent until first tab). */
export { viewer };

/** Non-reactive read of one server's viewer state bucket. */
export function getServerViewer(serverId: string): ViewerServerState | undefined {
  return viewer[serverId];
}

/** Basename of a slash path ("src/App.tsx" -> "App.tsx"; "/" -> "/"). */
export function tabNameOf(path: string): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}

/**
 * Opens a file tab: appends a new tab (unless the path is already open)
 * and activates it. Empty paths are ignored.
 */
export function openTab(serverId: string, path: string, name?: string): void {
  if (path === "") return;
  setViewer(
    produce((draft) => {
      const server = draft[serverId] ?? { tabs: [], activePath: null, activeLine: null };
      if (!server.tabs.some((tab) => tab.path === path)) {
        server.tabs.push({ path, name: name ?? tabNameOf(path) });
      }
      server.activePath = path;
      draft[serverId] = server;
    }),
  );
}

/**
 * Closes a tab. Closing the active tab activates the left neighbor, or
 * the tab that slid into the closed position when it was first, or
 * nothing when it was the last tab.
 */
export function closeTab(serverId: string, path: string): void {
  setViewer(
    produce((draft) => {
      const server = draft[serverId];
      if (server === undefined) return;
      const index = server.tabs.findIndex((tab) => tab.path === path);
      if (index === -1) return;
      server.tabs.splice(index, 1);
      if (server.activePath === path) {
        server.activePath =
          (index > 0 ? server.tabs[index - 1]?.path : undefined) ??
          server.tabs[index]?.path ??
          null;
      }
      draft[serverId] = server;
    }),
  );
}

/** Activates an open tab; unknown paths are ignored. */
export function setActive(serverId: string, path: string): void {
  setViewer(
    produce((draft) => {
      const server = draft[serverId];
      if (server === undefined || !server.tabs.some((tab) => tab.path === path)) return;
      server.activePath = path;
      draft[serverId] = server;
    }),
  );
}

/** Clears all viewer state for a server (context rebuilds, M4-03). */
export function resetServer(serverId: string): void {
  setViewer(
    produce((draft) => {
      delete draft[serverId];
    }),
  );
}

/**
 * Sets or clears the pending hit-line target (TASK-M4-05). A non-null
 * path must be an open tab; unknown paths are ignored. Pass null to
 * clear a consumed target.
 */
export function setActiveLine(serverId: string, path: string | null, line?: number): void {
  setViewer(
    produce((draft) => {
      const server = draft[serverId];
      if (server === undefined) return;
      if (path === null || !server.tabs.some((tab) => tab.path === path)) {
        server.activeLine = null;
        return;
      }
      server.activeLine = { path, line: line ?? 0 };
    }),
  );
}
