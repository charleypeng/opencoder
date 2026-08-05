#!/usr/bin/env node
// L0 i18n key completeness check (TASK-M9-01). Scans src/**/*.{ts,tsx} for
// t("...") call sites (bare keys resolve to the default "common"
// namespace, "ns:key" forms resolve to the named namespace), then asserts
// every resolved key exists in BOTH en.json and zh-CN.json, and that the
// en/zh key sets are identical. Exits 1 listing every problem.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const I18N_DIR = resolve(ROOT, "src/i18n");
const DEFAULT_NS = "common";
const NAMESPACES = [
  "common",
  "servers",
  "sessions",
  "messages",
  "files",
  "vcs",
  "permissions",
  "questions",
  "commands",
  "models",
  "terminal",
  "settings",
  "pet",
  "mobile",
  "desktop",
  "updates",
  "notifications",
  "palette",
  "errors",
];
// A t() call is a `t(` not preceded by an identifier character (it(...),
// request(...), useT() ... never match) followed by a quoted key.
const T_CALL = /(?<![A-Za-z])t\(\s*(['"`])([^'"`]+)\1/g;

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function loadResources() {
  const read = (file) => JSON.parse(readFileSync(resolve(I18N_DIR, file), "utf8"));
  return { en: read("en.json"), zh: read("zh-CN.json") };
}

function flattenKeys(resource, prefix = "", out = []) {
  for (const [key, value] of Object.entries(resource)) {
    if (typeof value === "string") {
      out.push(`${prefix}${key}`);
    } else {
      flattenKeys(value, `${prefix}${key}.`, out);
    }
  }
  return out;
}

// A leaf is present when the exact key or one of its plural forms exists
// (i18next resolves "key" + count against key_one / key_other / key_0 ...).
function present(namespace, leaf, resource) {
  if (namespace in resource) {
    const keys = resource[namespace];
    if (leaf in keys) return true;
    return ["_one", "_other", "_0", "_1"].some((suffix) => `${leaf}${suffix}` in keys);
  }
  return false;
}

function resolveKey(rawKey) {
  const colon = rawKey.indexOf(":");
  if (colon > 0 && NAMESPACES.includes(rawKey.slice(0, colon))) {
    return { ns: rawKey.slice(0, colon), leaf: rawKey.slice(colon + 1) };
  }
  return { ns: DEFAULT_NS, leaf: rawKey };
}

const { en, zh } = loadResources();
const problems = [];

const enKeys = flattenKeys(en).sort();
const zhKeys = flattenKeys(zh).sort();
if (JSON.stringify(enKeys) !== JSON.stringify(zhKeys)) {
  const onlyEn = enKeys.filter((k) => !zhKeys.includes(k));
  const onlyZh = zhKeys.filter((k) => !enKeys.includes(k));
  for (const key of onlyEn)
    problems.push(`key set mismatch: "${key}" exists in en.json but not zh-CN.json`);
  for (const key of onlyZh)
    problems.push(`key set mismatch: "${key}" exists in zh-CN.json but not en.json`);
}

for (const file of walk(resolve(ROOT, "src"), [])) {
  const source = readFileSync(file, "utf8");
  for (const line of source.split("\n")) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const match of line.matchAll(T_CALL)) {
      const rawKey = match[2].trim();
      if (rawKey === "" || rawKey.includes("${") || rawKey.includes("{")) continue;
      const { ns, leaf } = resolveKey(rawKey);
      const rel = file.slice(ROOT.length + 1);
      if (!present(ns, leaf, en)) {
        problems.push(`${rel}: t("${rawKey}") -> unknown key "${ns}:${leaf}" in en.json`);
      }
      if (!present(ns, leaf, zh)) {
        problems.push(`${rel}: t("${rawKey}") -> unknown key "${ns}:${leaf}" in zh-CN.json`);
      }
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`check-i18n: ${problems.length} problem(s) found:\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`check-i18n: OK (${enKeys.length} keys, en/zh aligned)\n`);
