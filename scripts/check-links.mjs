#!/usr/bin/env node
// Markdown link checker (TASK-M10-05): scans the user-facing docs —
// README.md, README-zh.md, CONTRIBUTING.md and every top-level docs/*.md —
// and verifies every markdown link/image target that points into the
// repository. External links (http(s), mailto, ...), bare anchors and
// reference-style links are skipped; relative targets must exist on disk
// (case-insensitive, so macOS and Linux agree) with any #anchor suffix
// stripped. Broken targets are reported with file:line and the script
// exits 1, wired into `pnpm verify` as the "L0 links" step.

import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** The scanned files: the root READMEs + contributing guide + top-level docs. */
function scanFiles() {
  const files = ["README.md", "README-zh.md", "CONTRIBUTING.md"];
  const docsDir = join(ROOT, "docs");
  for (const name of readdirSync(docsDir)) {
    if (name.endsWith(".md") && statSync(join(docsDir, name)).isFile()) {
      files.push(`docs/${name}`);
    }
  }
  return files;
}

/** Case-insensitive existence: walk the path from the nearest existing
 *  ancestor, comparing each segment in lowercase (Linux CI is
 *  case-sensitive; macOS is not — the check must agree on both). */
function existsInsensitive(abs) {
  const missing = [];
  let anchor = abs;
  while (!existsSync(anchor)) {
    missing.unshift(basename(anchor));
    anchor = dirname(anchor);
  }
  let current = anchor;
  for (const segment of missing) {
    const entry = readdirSync(current).find((name) => name.toLowerCase() === segment.toLowerCase());
    if (entry === undefined) return false;
    current = join(current, entry);
  }
  return true;
}

const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function scan(file) {
  const abs = resolve(ROOT, file);
  const lines = readFileSync(abs, "utf8").split("\n");
  const broken = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (const match of lines[i].matchAll(LINK_RE)) {
      const target = match[1];
      if (SCHEME_RE.test(target)) continue; // http(s), mailto, ...
      if (target.startsWith("#")) continue; // same-file anchor
      const pathPart = target.split("#")[0].trim();
      if (pathPart === "") continue;
      const targetAbs = resolve(dirname(abs), pathPart);
      if (!existsInsensitive(targetAbs)) {
        broken.push(`${file}:${i + 1}: ${match[0]}`);
      }
    }
  }
  return broken;
}

const allBroken = [];
for (const file of scanFiles()) {
  allBroken.push(...scan(file));
}

if (allBroken.length > 0) {
  process.stderr.write(`check-links: ${allBroken.length} broken link(s):\n`);
  for (const item of allBroken) process.stderr.write(`  ${item}\n`);
  process.exit(1);
}
process.stdout.write(`check-links: OK (${scanFiles().length} files scanned)\n`);
