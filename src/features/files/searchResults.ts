// Pure result-shaping helpers for the full-text search panel (TASK-M4-05):
// matches group by file in first-seen order, and hit spans come from the
// server's submatches when present (clamped to the line), falling back to a
// client-side first match of the searched pattern — literal or regex. Both
// stay framework-free so L1 tests cover them directly.

import type { FindMatch } from "../../services/find.js";

export interface Span {
  start: number;
  end: number;
}

export interface FileHitGroup {
  path: string;
  matches: FindMatch[];
}

/** Groups matches by `path.text`, preserving first-seen file order. */
export function groupByFile(matches: FindMatch[]): FileHitGroup[] {
  const groups: FileHitGroup[] = [];
  const byPath = new Map<string, FileHitGroup>();
  for (const match of matches) {
    const path = match.path.text;
    let group = byPath.get(path);
    if (group === undefined) {
      group = { path, matches: [] };
      byPath.set(path, group);
      groups.push(group);
    }
    group.matches.push(match);
  }
  return groups;
}

/** First occurrence of the searched pattern in a line; null when absent. */
export function firstOccurrence(line: string, pattern: string, regex: boolean): Span | null {
  if (pattern === "") return null;
  try {
    if (regex) {
      const match = new RegExp(pattern, "i").exec(line);
      if (match === null) return null;
      return { start: match.index, end: match.index + match[0].length };
    }
    const index = line.toLowerCase().indexOf(pattern.toLowerCase());
    return index === -1 ? null : { start: index, end: index + pattern.length };
  } catch {
    return null;
  }
}

/**
 * Hit spans for one match's line: the server's submatches win (clamped to
 * the line length, empty spans dropped); without them, the first match of
 * the searched pattern is highlighted instead.
 */
export function highlightSpans(match: FindMatch, pattern: string, regex: boolean): Span[] {
  const line = match.lines.text;
  const fromSubmatches = match.submatches
    .map((sub) => ({
      start: Math.min(Math.max(0, sub.start), line.length),
      end: Math.min(Math.max(0, sub.end), line.length),
    }))
    .filter((span) => span.end > span.start);
  if (fromSubmatches.length > 0) return fromSubmatches;
  const first = firstOccurrence(line, pattern, regex);
  return first === null ? [] : [first];
}
