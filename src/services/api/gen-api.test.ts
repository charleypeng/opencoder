import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("OpenAPI type generation (L0)", () => {
  it("schema.d.ts is in sync with the OpenAPI contract", () => {
    const result = spawnSync(process.execPath, [join("scripts", "gen-api.mjs"), "--check"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status, result.stderr ?? "").toBe(0);
  }, 60_000);
});
