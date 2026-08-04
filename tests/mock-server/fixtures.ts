import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

// Fixture loader.
//
// Reads <root>/index.json and loads every referenced JSON file once into a
// cache, served to routes by key.
//
// The root defaults to tests/mock-server/fixtures (hand-written skeletons).
// Set MOCK_FIXTURES_DIR to an alternate root — e.g. the recorded fixtures in
// tests/fixtures — to serve those instead:
//
//   MOCK_FIXTURES_DIR=tests/fixtures pnpm mock:start

export type Fixtures = Record<string, unknown>;

const DEFAULT_FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// Resolves the fixtures root: MOCK_FIXTURES_DIR (relative to the working
// directory) when set, otherwise the built-in mock fixtures.
export function fixturesRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MOCK_FIXTURES_DIR;
  if (!override) return DEFAULT_FIXTURES_DIR;
  return isAbsolute(override) ? override : join(process.cwd(), override);
}

let cache: Fixtures | undefined;
let cacheRoot: string | undefined;

// Loads (and caches) all fixtures referenced by the index file.
//
// When MOCK_FIXTURES_DIR points at an alternate root (recorded fixtures),
// keys missing from that index fall back to the built-in mock fixtures so
// every registered route still resolves (e.g. `path`, `session.status`).
export function loadFixtures(): Fixtures {
  const root = fixturesRoot();
  if (cache && cacheRoot === root) return cache;

  const loaded: Fixtures = {};
  for (const base of [root, DEFAULT_FIXTURES_DIR]) {
    const indexPath = join(base, "index.json");
    if (!existsSync(indexPath)) {
      if (base === root) throw new Error(`fixture index not found: ${indexPath}`);
      continue;
    }
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, string>;
    for (const [key, fileName] of Object.entries(index)) {
      if (key in loaded) continue;
      const filePath = join(base, fileName);
      if (!existsSync(filePath)) {
        throw new Error(`fixture file missing for "${key}": ${filePath}`);
      }
      loaded[key] = JSON.parse(readFileSync(filePath, "utf8"));
    }
  }

  cache = loaded;
  cacheRoot = root;
  return cache;
}
