#!/usr/bin/env node
// Startup bundle size guard (docs/ui-audit-2026-08 §5): fails when the
// gzip size of the vite startup chunk (dist/assets/index-*.js) exceeds
// the budget. CI runs it right after `pnpm build`; locally:
// `pnpm build && pnpm check:bundle`. The lazy chunks (xterm, shiki
// grammars) stay out of the budget on purpose — see docs/performance.md.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist", "assets");
// The 2026-08 audit measured 320.46 KB gzip; the budget leaves ~10 KB
// headroom and turns any further drift into a hard failure.
const BUDGET_KB = 330;

const chunks = readdirSync(DIST)
  .filter((name) => /^index-.*\.js$/.test(name))
  .map((name) => join(DIST, name));

if (chunks.length === 0) {
  console.error(`check-bundle: no dist/assets/index-*.js found — run "pnpm build" first.`);
  process.exit(1);
}

let totalGzip = 0;
for (const file of chunks) {
  const raw = statSync(file).size;
  const gzipped = gzipSync(readFileSync(file)).length;
  totalGzip += gzipped;
  console.log(
    `check-bundle: ${file.slice(ROOT.length + 1)} — ${(raw / 1024).toFixed(2)} KB raw, ` +
      `${(gzipped / 1024).toFixed(2)} KB gzip`,
  );
}

const totalKB = totalGzip / 1024;
if (totalKB > BUDGET_KB) {
  console.error(
    `check-bundle: FAIL — startup bundle ${totalKB.toFixed(2)} KB gzip exceeds the ` +
      `${BUDGET_KB} KB budget. Trim the entry imports or re-audit the budget ` +
      `(docs/performance.md).`,
  );
  process.exit(1);
}
console.log(`check-bundle: OK (${totalKB.toFixed(2)} KB gzip ≤ ${BUDGET_KB} KB budget)`);
