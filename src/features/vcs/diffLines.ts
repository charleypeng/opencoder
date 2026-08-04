// Unified-diff line helpers (TASK-M4-07): shared parsing/folding/alignment
// for the diff views, extracted from the FileViewer's diff coloring so the
// session diff view and the file viewer classify lines identically (no diff
// library). `rowKindOf` classifies a raw line by prefix; `parseUnifiedDiff`
// turns patch text into typed rows with old/new line numbers tracked
// through the @@ hunk headers; `foldGroups` collapses long runs of
// unchanged context lines behind an expandable handle; `alignSplit` pairs
// the old/new sides for the side-by-side view.

export type DiffLineKind = "add" | "del" | "ctx" | "hunk" | "meta";

/** How a diff renders: unified rows or side-by-side split columns. */
export type DiffMode = "unified" | "split";

export interface DiffLine {
  kind: DiffLineKind;
  /** Line number in the old file; null for added lines and headers. */
  oldLine: number | null;
  /** Line number in the new file; null for removed lines and headers. */
  newLine: number | null;
  text: string;
}

/** Other git metadata lines (diff/rename/copy headers, index lines). */
const META_PREFIX_RE =
  /^(?:diff --git|index |new file|deleted file|rename |copy |similarity |dissimilarity |\\)/;

/** Classifies one unified-diff line by its prefix (no diff library). */
export function rowKindOf(line: string): DiffLineKind {
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  if (line.startsWith("---") || line.startsWith("+++")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (META_PREFIX_RE.test(line)) return "meta";
  return "ctx";
}

/** `@@ -oldStart[,oldCount] +newStart[,newCount] @@` (counts optional). */
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parses unified diff/patch text into rows with per-line old/new numbers.
 * Numbers are tracked from the hunk headers; lines before any hunk header
 * (or in header-free patches) carry null numbers.
 */
export function parseUnifiedDiff(text: string): DiffLine[] {
  const rows: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  // Numbers are only tracked after a parsable @@ hunk header; lines before
  // it (or in header-free patches) carry null numbers.
  let numbered = false;
  for (const raw of text.split("\n")) {
    // Git encodes empty context as a single space; bare empty lines only
    // appear as the trailing fragment of a newline-terminated patch.
    if (raw === "") continue;
    const kind = rowKindOf(raw);
    if (kind === "hunk") {
      const match = HUNK_RE.exec(raw);
      if (match !== null) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
        numbered = true;
      }
      rows.push({ kind, oldLine: null, newLine: null, text: raw });
      continue;
    }
    if (numbered) {
      if (kind === "add") {
        rows.push({ kind, oldLine: null, newLine, text: raw });
        newLine += 1;
        continue;
      }
      if (kind === "del") {
        rows.push({ kind, oldLine, newLine: null, text: raw });
        oldLine += 1;
        continue;
      }
      if (kind === "ctx") {
        rows.push({ kind, oldLine, newLine, text: raw });
        oldLine += 1;
        newLine += 1;
        continue;
      }
    }
    rows.push({ kind, oldLine: null, newLine: null, text: raw });
  }
  return rows;
}

/** One rendered block of a diff: an ordinary row or a collapsible run. */
export interface FoldGroup {
  /** Stable key of a collapsible context run; null for ordinary rows. */
  key: string | null;
  /** The full run of rows (all of them; the visible slice is a subset). */
  lines: DiffLine[];
  /** Rows shown while collapsed. */
  visible: number;
  /** Rows hidden behind the fold handle while collapsed. */
  foldCount: number;
}

/** Context runs longer than this collapse behind the fold handle. */
export const MAX_VISIBLE_CONTEXT = 3;

/**
 * Splits rows into render groups, folding runs of more than `maxCtx`
 * consecutive unchanged context lines into a group with a `foldCount`
 * handle (the full run stays on the group for expansion).
 */
export function foldGroups(lines: DiffLine[], maxCtx = MAX_VISIBLE_CONTEXT): FoldGroup[] {
  const out: FoldGroup[] = [];
  let run: DiffLine[] = [];
  let foldSeq = 0;
  function flush(): void {
    if (run.length === 0) return;
    if (run.length > maxCtx) {
      out.push({
        key: `fold-${foldSeq}`,
        lines: run,
        visible: maxCtx,
        foldCount: run.length - maxCtx,
      });
      foldSeq += 1;
    } else {
      for (const line of run) out.push({ key: null, lines: [line], visible: 1, foldCount: 0 });
    }
    run = [];
  }
  for (const line of lines) {
    if (line.kind === "ctx") {
      run.push(line);
      continue;
    }
    flush();
    out.push({ key: null, lines: [line], visible: 1, foldCount: 0 });
  }
  flush();
  return out;
}

/** Rows of a fold group to render: the whole run when expanded. */
export function visibleLines(group: FoldGroup, expanded: boolean): DiffLine[] {
  if (group.key === null || expanded) return group.lines;
  return group.lines.slice(0, group.visible);
}

/** One side-by-side row: a spanning header or an old/new pair. */
export interface SplitRow {
  kind: "pair" | "span";
  /** Old side; null = the side has no line (added/removed counterpart). */
  old: DiffLine | null;
  /** New side; null = the side has no line (added/removed counterpart). */
  new: DiffLine | null;
}

/**
 * Aligns parsed rows for the split view. Hunk/meta rows span both columns;
 * context lines pair one-to-one; removed lines pair with the following
 * added lines when counts line up (approximate alignment by design).
 */
export function alignSplit(lines: DiffLine[]): SplitRow[] {
  const out: SplitRow[] = [];
  const pendingDels: DiffLine[] = [];
  function flushDels(): void {
    for (const del of pendingDels) out.push({ kind: "pair", old: del, new: null });
    pendingDels.length = 0;
  }
  for (const line of lines) {
    if (line.kind === "ctx") {
      flushDels();
      out.push({ kind: "pair", old: line, new: line });
    } else if (line.kind === "del") {
      pendingDels.push(line);
    } else if (line.kind === "add") {
      out.push({ kind: "pair", old: pendingDels.shift() ?? null, new: line });
    } else {
      flushDels();
      out.push({ kind: "span", old: line, new: line });
    }
  }
  flushDels();
  return out;
}
