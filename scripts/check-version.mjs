#!/usr/bin/env node
// Release version sync check (TASK-M10-04). Asserts that the version derived
// from the release tag matches all three version sources of the project:
//   package.json          -> "version"
//   src-tauri/tauri.conf.json -> "version"
//   src-tauri/Cargo.toml  -> package "version" (first `version = "..."` line)
// Usage: node scripts/check-version.mjs <version>
// Accepts a tag like "v0.1.0" or a bare "0.1.0"; exits 1 listing every
// mismatch. Wired into .github/workflows/release.yml before any build runs.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const expected = process.argv[2]?.replace(/^v/, "");

if (!expected) {
  process.stderr.write("usage: node scripts/check-version.mjs <version>\n");
  process.exit(2);
}

function readJson(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
}

function cargoVersion() {
  const source = readFileSync(resolve(ROOT, "src-tauri/Cargo.toml"), "utf8");
  const match = /^version\s*=\s*"([^"]+)"/m.exec(source);
  return match ? match[1] : null;
}

const sources = [
  ["package.json", String(readJson("package.json").version)],
  ["src-tauri/tauri.conf.json", String(readJson("src-tauri/tauri.conf.json").version)],
  ["src-tauri/Cargo.toml", cargoVersion()],
];

const mismatches = sources.filter(([, actual]) => actual !== expected);
if (mismatches.length > 0) {
  process.stderr.write(`check-version: expected ${expected}, mismatches found:\n`);
  for (const [file, actual] of mismatches) {
    process.stderr.write(`  - ${file}: "${actual}" != "${expected}"\n`);
  }
  process.exit(1);
}
process.stdout.write(`check-version: OK (${expected} matches all ${sources.length} sources)\n`);
