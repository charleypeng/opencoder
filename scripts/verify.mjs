#!/usr/bin/env node
// Aggregated quality gate: runs all L0-L3 checks in order and exits
// non-zero on the first failure. Mirrors docs/testing.md §4 (ci.yml).

import { execSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const steps = [
  { name: "L0 eslint", cmd: "pnpm exec eslint . --max-warnings 0" },
  { name: "L0 prettier", cmd: "pnpm exec prettier --check ." },
  { name: "L0 tsc", cmd: "pnpm exec tsc -b" },
  { name: "L0 cargo fmt", cmd: "cargo fmt --check", cwd: "src-tauri" },
  { name: "L0 cargo clippy", cmd: "cargo clippy --all-targets -- -D warnings", cwd: "src-tauri" },
  { name: "L0 i18n keys", cmd: "pnpm check:i18n" },
  { name: "L0 links", cmd: "pnpm check:links" },
  { name: "L0 hardcoded strings", cmd: "node scripts/check-hardcoded.mjs" },
  { name: "L1 vitest", cmd: "pnpm test" },
  { name: "L3 mock:test", cmd: "pnpm mock:test" },
  { name: "gen:api:check", cmd: "pnpm gen:api:check" },
];

function run(step) {
  const label = `[${step.name}]`;
  process.stdout.write(`${label} running...\n`);
  const opts = { stdio: "inherit", cwd: step.cwd ? resolve(ROOT, step.cwd) : ROOT };
  try {
    execSync(step.cmd, opts);
    process.stdout.write(`${label} PASS\n`);
    return true;
  } catch {
    process.stdout.write(`${label} FAIL\n`);
    return false;
  }
}

const total = steps.length;
let passed = 0;
for (const step of steps) {
  const ok = run(step);
  if (!ok) {
    process.stdout.write(
      `\nverify: FAILED at step "${step.name}" (${passed}/${total} passed). Exiting.\n`,
    );
    process.exit(1);
  }
  passed += 1;
}
process.stdout.write(`\nverify: all ${total}/${total} checks passed.\n`);
