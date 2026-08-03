import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Fixture loader.
//
// Reads tests/mock-server/fixtures/index.json and loads every referenced JSON
// file once into a cache, served to routes by key.
// Hand-written skeletons today; recorded fixtures from a real server arrive
// with TASK-M0-06, which can extend the same index.

export type Fixtures = Record<string, unknown>;

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

let cache: Fixtures | undefined;

// Loads (and caches) all fixtures referenced by the index file.
export function loadFixtures(): Fixtures {
  if (cache) return cache;

  const index = JSON.parse(readFileSync(join(FIXTURES_DIR, "index.json"), "utf8")) as Record<string, string>;
  const loaded: Fixtures = {};

  for (const [key, fileName] of Object.entries(index)) {
    const filePath = join(FIXTURES_DIR, fileName);
    if (!readdirSync(FIXTURES_DIR).includes(fileName)) {
      throw new Error(`fixture file missing for "${key}": ${fileName}`);
    }
    loaded[key] = JSON.parse(readFileSync(filePath, "utf8"));
  }

  cache = loaded;
  return cache;
}
