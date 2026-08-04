// Result ranking for QuickOpen (TASK-M4-04): a pure ordering of the raw
// `/find/file` result paths. Results are bucketed by match quality — the
// query as a case-insensitive path prefix first, then as a substring, then
// the server's other fuzzy matches last — and within a bucket the per-server
// recent-file list gets the top spots (most recently opened first), while
// everything else keeps the server's order. Pure so the L1 tests can pin
// the ordering without rendering the dialog.

export interface RankedEntry {
  path: string;
  /** 0 = case-insensitive path prefix, 1 = substring, 2 = other fuzzy. */
  bucket: number;
  /** Index in the recent list (most recent first); -1 when not recent. */
  recentIndex: number;
}

export function rankResults(
  query: string,
  results: string[],
  recent: string[] = [],
): RankedEntry[] {
  const q = query.trim().toLowerCase();
  const ranked: RankedEntry[] = results.map((path) => {
    const index = path.toLowerCase().indexOf(q);
    const bucket = q === "" || index === 0 ? 0 : index > 0 ? 1 : 2;
    return { path, bucket, recentIndex: recent.indexOf(path) };
  });
  // Stable sort: bucket, then recent-first, then most-recent-first; ties
  // keep the server's result order.
  ranked.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    const aRecent = a.recentIndex >= 0 ? 0 : 1;
    const bRecent = b.recentIndex >= 0 ? 0 : 1;
    if (aRecent !== bRecent) return aRecent - bRecent;
    return a.recentIndex - b.recentIndex;
  });
  return ranked;
}
