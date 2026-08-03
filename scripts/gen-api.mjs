// OpenAPI type generation pipeline.
//
// Generates TypeScript types from the OpenCode OpenAPI contract
// (docs/openapi_v1.18.11.json) into src/services/api/schema.d.ts using
// openapi-typescript.
//
// Usage:
//   node scripts/gen-api.mjs            # (re)generate schema.d.ts
//   node scripts/gen-api.mjs --check    # exit non-zero if schema.d.ts is stale
//
// The generated schema.d.ts is the type source for all API calls and must be
// committed together with the contract. When the contract changes, regenerate
// and commit both files; see the "API contract & type generation" section in
// README.md for the upgrade flow.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = join(root, "docs", "openapi_v1.18.11.json");
const output = join(root, "src", "services", "api", "schema.d.ts");
const check = process.argv.includes("--check");

// Invoke the CLI through the Node executable and its JS entry point instead of
// the platform-dependent node_modules/.bin shim, which breaks on Windows
// (.cmd wrapper).
const cli = join(root, "node_modules", "openapi-typescript", "bin", "cli.js");
const result = spawnSync(process.execPath, [cli, input, "-o", output, ...(check ? ["--check"] : [])], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`gen-api: failed to run openapi-typescript: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
