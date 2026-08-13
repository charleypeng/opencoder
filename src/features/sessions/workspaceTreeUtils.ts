// Workspace tree helpers (sidebar nav redesign): pure functions that turn
// the store's flat session list plus the project list into the
// workspace → folder → sessions tree the sidebar renders. A folder is one
// working directory; only ROOT sessions (parentID unset) belong to the
// tree — subagent children live in the per-session subtask panel, never
// here. Empty folders come from projects that have no sessions yet, so
// every known directory stays visible (WorkBuddy-style).

import type { Session } from "../../services/session.js";
import type { Project } from "../../services/project.js";

export interface WorkspaceFolder {
  /** Working-directory absolute path; the folder's identity. */
  directory: string;
  /** Display name: project.name when set, else basename(directory). */
  name: string;
  /** Matching project (icon/name source); undefined for unlisted dirs. */
  project?: Project;
  /** Root sessions in this directory, most recently updated first. */
  sessions: Session[];
  /** Latest session update in the folder (folder sorting key). */
  recentMs: number;
}

export interface WorkspaceTree {
  /** Known directories with their sessions, active-first. */
  folders: WorkspaceFolder[];
  /** Root sessions without a directory (defensive; contract says every
   *  session carries one, but keep them visible rather than dropping). */
  uncategorized: Session[];
}

/** Basename of a path ("/a/b" -> "b", "/" -> "/"). */
export function basename(path: string): string {
  const parts = path.split("/").filter((s) => s !== "");
  return parts.length === 0 ? "/" : parts[parts.length - 1];
}

/** Folders are sorted by their most recent session update (active first);
 *  empty folders fall back to their project's last-opened time, then 0. */
function folderRecency(folder: WorkspaceFolder): number {
  if (folder.sessions.length > 0) return folder.recentMs;
  return folder.project?.time?.updated ?? 0;
}

export function buildWorkspaceTree(sessions: Session[], projects: Project[]): WorkspaceTree {
  // Only root sessions enter the tree (subagents are panel-only); the API
  // already filters with roots=true, this is the client-side guarantee.
  const roots = sessions.filter((s) => s.parentID === undefined);

  const byDirectory = new Map<string, Session[]>();
  const uncategorized: Session[] = [];
  for (const session of roots) {
    if (session.directory === undefined || session.directory === "") {
      uncategorized.push(session);
      continue;
    }
    const list = byDirectory.get(session.directory);
    if (list === undefined) byDirectory.set(session.directory, [session]);
    else list.push(session);
  }

  // Every folder sorts its sessions newest-first.
  const sortNewest = (list: Session[]): Session[] =>
    [...list].sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));

  // Name resolution: project.name wins, else basename; duplicate basenames
  // keep their full path as a fallback label so /a/blog and /b/blog stay
  // distinguishable (the UI shows the full path on hover).
  const projectByWorktree = new Map<string, Project>();
  for (const project of projects) {
    if (project.worktree !== undefined) projectByWorktree.set(project.worktree, project);
  }
  const usedNames = new Map<string, number>();
  const resolveName = (directory: string, project: Project | undefined): string => {
    const base = project?.name ?? basename(directory);
    const count = usedNames.get(base) ?? 0;
    usedNames.set(base, count + 1);
    return count === 0 ? base : directory;
  };

  const folders: WorkspaceFolder[] = [];
  for (const [directory, list] of byDirectory) {
    const sessionsInDir = sortNewest(list);
    const project = projectByWorktree.get(directory);
    folders.push({
      directory,
      name: resolveName(directory, project),
      project,
      sessions: sessionsInDir,
      recentMs: sessionsInDir[0]?.time?.updated ?? 0,
    });
  }

  // Empty directories: projects whose worktree has no sessions yet.
  for (const project of projects) {
    if (project.worktree === undefined) continue;
    if (byDirectory.has(project.worktree)) continue;
    if (folders.some((f) => f.directory === project.worktree)) continue;
    folders.push({
      directory: project.worktree,
      name: resolveName(project.worktree, project),
      project,
      sessions: [],
      recentMs: 0,
    });
  }

  folders.sort((a, b) => folderRecency(b) - folderRecency(a));
  return { folders, uncategorized };
}
