// Session tree helpers (TASK-M6-07): pure functions that turn the store's
// flat session list into the tree the session list renders. `childrenOf`
// groups sessions by parentID; `topLevelRoots` picks the matched sessions
// that own a subtree — a session with a transitively matched ancestor is
// NOT a root (it already renders inside that ancestor's subtree, so it must
// not also stand alone: the TASK-M6-03 duplicate-row fix); `buildSessionTree`
// nests the whole store's children under the given roots with depths.

import type { Session } from "../../services/session.js";

export interface SessionTreeNode {
  session: Session;
  depth: number;
  children: SessionTreeNode[];
}

/** parentID -> direct child sessions in input (store) order. */
export function childrenOf(sessions: Session[]): Map<string, Session[]> {
  const map = new Map<string, Session[]>();
  for (const session of sessions) {
    if (session.parentID === undefined) continue;
    const list = map.get(session.parentID);
    if (list === undefined) map.set(session.parentID, [session]);
    else list.push(session);
  }
  return map;
}

/** The matched sessions that act as tree roots: sessions whose ancestor
 *  chain (walking parentID; a parent missing from the store ends the chain)
 *  contains NO matched session. */
export function topLevelRoots(matched: Session[], all: Session[]): Session[] {
  const matchedIds = new Set(matched.map((s) => s.id));
  const byId = new Map(all.map((s) => [s.id, s]));
  function hasMatchedAncestor(sessionId: string, seen: Set<string>): boolean {
    const parentID = byId.get(sessionId)?.parentID;
    if (parentID === undefined || seen.has(parentID)) return false;
    if (matchedIds.has(parentID)) return true;
    seen.add(parentID);
    return hasMatchedAncestor(parentID, seen);
  }
  return matched.filter((s) => !hasMatchedAncestor(s.id, new Set()));
}

/** Nests children (looked up over the WHOLE session list, so a matched
 *  parent pulls its entire subtree along) under the given roots. */
export function buildSessionTree(sessions: Session[], roots: Session[]): SessionTreeNode[] {
  const byParent = childrenOf(sessions);
  const build = (session: Session, depth: number): SessionTreeNode => ({
    session,
    depth,
    children: (byParent.get(session.id) ?? []).map((child) => build(child, depth + 1)),
  });
  return roots.map((root) => build(root, 0));
}
