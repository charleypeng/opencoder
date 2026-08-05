#!/usr/bin/env node
// L0 hardcoded-string scan (TASK-M9-02). Best-effort detector that flags
// user-visible English copy left OUTSIDE the i18n resources:
//   - JSX text nodes with >= 3 English words (>= 2 letters each) or with
//     more than 40 characters that contain at least one English word
//   - aria-label / placeholder / title / alt attribute values matching the
//     same thresholds
//
// The detector is intentionally heuristic and WILL produce false positives
// (CSS class names, data, format strings). Three escape hatches, in order
// of preference:
//   1. Migrate the string into i18n (t("ns:key")) — the real fix.
//   2. Suppress a specific line with a trailing `// i18n-ignore` comment or
//      a leading `// i18n-ignore` on the previous line. Block scope:
//      `/* i18n-ignore */` on its own line.
//   3. Allowlist an exact match in scripts/i18n-allowlist.json:
//      [ { "file": "src/features/x.tsx", "text": "exact line fragment" } ]
//
// Exits 1 listing every finding. The first finding on a line reports the
// full offending fragment; further fragments on the same line are omitted
// so one migration fixes the whole line.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ALLOWLIST_FILE = resolve(ROOT, "scripts/i18n-allowlist.json");

const MIN_WORDS = 3;
const MIN_LEN = 40;

// JSX text node: `>` ... `<` with no angle brackets or JSX expression
// braces inside (pure text, single line).
const TEXT_NODE = />([^<>{}]{2,})</g;
// Attribute values that are user-visible copy.
const ATTR = /\b(aria-label|placeholder|title|alt)=(["'])([^"']{2,})\2/g;
// Anything that still contains a template expression is not plain copy.
const HAS_EXPR = /[{}\s$][{}]|\$\{/;
const WORD = /[A-Za-z]{2,}/g;

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_FILE)) return [];
  return JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8"));
}

function englishMetrics(text) {
  const words = text.match(WORD) ?? [];
  return { wordCount: words.length, charCount: text.trim().length };
}

/** True when the fragment crosses the flag threshold. */
function isFlagged(fragment) {
  if (HAS_EXPR.test(fragment)) return false;
  const { wordCount, charCount } = englishMetrics(fragment);
  return wordCount >= MIN_WORDS || (charCount > MIN_LEN && wordCount >= 1);
}

/** Removes comments so copy inside them never flags. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function inAllowlist(rel, fragment, allowlist) {
  return allowlist.some((entry) => entry.file === rel && fragment.includes(entry.text));
}

const allowlist = loadAllowlist();
const problems = [];

for (const file of walk(resolve(ROOT, "src"), [])) {
  const rel = file.slice(ROOT.length + 1);
  const source = stripComments(readFileSync(file, "utf8"));
  const ignored = new Set();
  const lines = source.split("\n");
  // Mark lines under a `// i18n-ignore` directive (previous line or same line).
  for (let i = 0; i < lines.length; i += 1) {
    if (/i18n-ignore/.test(lines[i])) {
      ignored.add(i);
      if (i > 0) ignored.add(i - 1);
    }
  }
  const candidates = [];
  for (const [lineIndex, line] of lines.entries()) {
    for (const match of line.matchAll(TEXT_NODE)) {
      const fragment = match[1].trim();
      if (fragment && isFlagged(fragment)) candidates.push({ lineIndex, fragment });
    }
    for (const match of line.matchAll(ATTR)) {
      const fragment = match[3].trim();
      if (fragment && isFlagged(fragment)) candidates.push({ lineIndex, fragment });
    }
  }
  // Deduplicate fragments per line; report the longest first so the fix
  // covers the whole line.
  const byLine = new Map();
  for (const { lineIndex, fragment } of candidates) {
    if (!byLine.has(lineIndex)) byLine.set(lineIndex, []);
    byLine.get(lineIndex).push(fragment);
  }
  for (const [lineIndex, fragments] of byLine) {
    if (ignored.has(lineIndex)) continue;
    const visible = fragments.filter((f) => !inAllowlist(rel, f, allowlist));
    if (visible.length === 0) continue;
    visible.sort((a, b) => b.length - a.length);
    problems.push(`${rel}:${lineIndex + 1}: ${JSON.stringify(visible[0])}`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`check-hardcoded: ${problems.length} finding(s):\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}
process.stdout.write("check-hardcoded: OK (no user-visible hardcoded strings)\n");
