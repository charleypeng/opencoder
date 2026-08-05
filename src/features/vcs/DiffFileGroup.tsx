// Shared per-file diff group (TASK-M4-08): one diff renderer for both the
// session diff view (SnapshotFileDiff entries) and the workspace diff view
// (VcsFileDiff entries). Extracted from DiffView (TASK-M4-07) so the two
// surfaces classify lines and fold long unchanged runs identically. Entries
// without patch content render as a stats card with a note.

import { createMemo, For, Show } from "solid-js";
import { useT } from "../../i18n/index.js";
import {
  alignSplit,
  foldGroups,
  parseUnifiedDiff,
  visibleLines,
  type DiffLine,
  type DiffMode,
  type FoldGroup,
  type SplitRow,
} from "./diffLines.js";

/** The shared entry shape: per-file stats plus optional unified patch text
 *  (SnapshotFileDiff and VcsFileDiff both satisfy it). */
export interface DiffFileEntry {
  file?: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
}

export interface DiffFileGroupProps {
  entry: DiffFileEntry;
  mode: DiffMode;
  expanded: () => Set<string>;
  toggleFold: (key: string) => void;
}

const lineNumberClass = "w-12 shrink-0 select-none text-right pr-3 text-fg-faint tabular-nums";

const rowClass: Record<DiffLine["kind"], string> = {
  add: "bg-success/15 text-success",
  del: "bg-danger/15 text-danger",
  hunk: "bg-bg-sunken text-fg-faint",
  meta: "bg-bg-sunken text-fg-faint",
  ctx: "text-fg-secondary",
};

function UnifiedRow(props: { line: DiffLine }) {
  return (
    <div
      data-testid="diff-row"
      data-kind={props.line.kind}
      class={`flex whitespace-pre-wrap break-words px-3 font-code text-xs leading-relaxed ${rowClass[props.line.kind]}`}
    >
      <span class={lineNumberClass}>{props.line.oldLine ?? ""}</span>
      <span class={lineNumberClass}>{props.line.newLine ?? ""}</span>
      <span class="min-w-0 flex-1">{props.line.text}</span>
    </div>
  );
}

function SplitCell(props: { line: DiffLine | null; side: "old" | "new" }) {
  return (
    <Show
      when={props.line !== null}
      fallback={<div data-testid="diff-split-cell" class="min-h-full bg-bg-sunken/50" />}
    >
      <div
        data-testid="diff-split-cell"
        data-kind={(props.line as DiffLine).kind}
        class={`flex whitespace-pre-wrap break-words px-3 font-code text-xs leading-relaxed ${rowClass[(props.line as DiffLine).kind]}`}
      >
        <span class={lineNumberClass}>
          {props.side === "old"
            ? ((props.line as DiffLine).oldLine ?? "")
            : ((props.line as DiffLine).newLine ?? "")}
        </span>
        <span class="min-w-0 flex-1">{(props.line as DiffLine).text}</span>
      </div>
    </Show>
  );
}

function SplitRow(props: { row: SplitRow }) {
  return (
    <div
      data-testid="diff-split-row"
      data-span={props.row.kind === "span" ? "true" : "false"}
      class={
        props.row.kind === "span"
          ? "flex whitespace-pre-wrap break-words bg-bg-sunken px-3 font-code text-xs leading-relaxed text-fg-faint"
          : "grid grid-cols-2"
      }
    >
      <Show
        when={props.row.kind === "span"}
        fallback={
          <>
            <SplitCell line={props.row.old} side="old" />
            <SplitCell line={props.row.new} side="new" />
          </>
        }
      >
        {props.row.old?.text ?? ""}
      </Show>
    </div>
  );
}

/** One file's diff: header (path, +N -M stats, status chip) + the rows. */
function DiffFileGroup(props: DiffFileGroupProps) {
  const t = useT();
  // Parsed rows; null when the entry carries no patch content (stats only).
  const rows = createMemo(() =>
    props.entry.patch === undefined ? null : parseUnifiedDiff(props.entry.patch),
  );
  const groups = createMemo<FoldGroup[]>(() =>
    rows() === null ? [] : foldGroups(rows() as DiffLine[]),
  );
  const split = createMemo<SplitRow[]>(() =>
    rows() === null ? [] : alignSplit(rows() as DiffLine[]),
  );

  return (
    <section data-testid="diff-file" class="flex min-w-0 flex-col">
      <header
        data-testid="diff-file-header"
        class="flex shrink-0 items-center gap-2 border-b border-bg-sunken bg-bg-elevated px-3 py-1.5"
      >
        <span class="min-w-0 flex-1 truncate font-code text-xs" title={props.entry.file ?? ""}>
          {props.entry.file ?? t("vcs:unknownFile")}
        </span>
        <span data-testid="diff-file-stats" class="shrink-0 font-code text-xs text-fg-secondary">
          +{props.entry.additions} -{props.entry.deletions}
        </span>
        <Show when={props.entry.status !== undefined}>
          <span
            data-testid="diff-file-status"
            data-status={props.entry.status}
            class={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${
              props.entry.status === "added"
                ? "bg-success/15 text-success"
                : props.entry.status === "deleted"
                  ? "bg-danger/15 text-danger"
                  : "bg-accent-soft text-accent"
            }`}
          >
            {props.entry.status}
          </span>
        </Show>
      </header>
      <Show
        when={rows() !== null}
        fallback={
          <p data-testid="diff-file-no-content" class="px-3 py-3 text-xs text-fg-secondary">
            Content not available for this diff.
          </p>
        }
      >
        <Show
          when={props.mode === "unified"}
          fallback={
            <div data-testid="diff-split" class="min-w-0 flex-1 overflow-x-auto">
              <div class="grid grid-cols-2 min-w-max">
                <For each={split()}>{(row) => <SplitRow row={row} />}</For>
              </div>
            </div>
          }
        >
          <div data-testid="diff-unified" class="min-w-0 flex-1 overflow-x-auto">
            <For each={groups()}>
              {(group) => {
                // Getter: reads expanded() inside the JSX memo, so a fold
                // toggle re-renders this group.
                const collapsed = () => group.key !== null && !props.expanded().has(group.key);
                return (
                  <>
                    <For each={visibleLines(group, !collapsed())}>
                      {(line) => <UnifiedRow line={line} />}
                    </For>
                    <Show when={collapsed()}>
                      <button
                        type="button"
                        data-testid="diff-fold"
                        data-key={group.key ?? ""}
                        class="block w-full px-3 py-1 text-left font-code text-xs text-fg-faint outline-none hover:text-accent"
                        onClick={() => props.toggleFold(group.key as string)}
                      >
                        … {group.foldCount} unchanged lines
                      </button>
                    </Show>
                  </>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}

export default DiffFileGroup;
