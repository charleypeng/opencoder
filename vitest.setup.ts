import "@testing-library/jest-dom/vitest";

// Node ≥26 ships built-in `localStorage` / `Storage` accessors on the global
// that resolve to undefined unless `--localstorage-file` is provided. Because
// those keys already exist on the Node global, vitest's jsdom bridge skips
// copying jsdom's working Web Storage over them (getWindowKeys keeps only its
// static allowlist for pre-existing keys), so every storage-backed suite sees
// `localStorage === undefined`. Install a Map-backed Storage class for both
// globals when the platform one is unusable — as a real class so suites that
// spy on `Storage.prototype` (e.g. storage-failure tests) still intercept.
// When the bridge/Node disagreement is fixed upstream, this stays inert.
function installStorageShim(): void {
  let broken = false;
  try {
    if (typeof globalThis.localStorage === "undefined") broken = true;
  } catch {
    broken = true;
  }
  if (!broken) return;
  class ShimStorage {
    private map = new Map<string, string>();
    get length(): number {
      return this.map.size;
    }
    clear(): void {
      this.map.clear();
    }
    getItem(key: string): string | null {
      return this.map.has(key) ? (this.map.get(key) as string) : null;
    }
    key(index: number): string | null {
      return Array.from(this.map.keys())[index] ?? null;
    }
    removeItem(key: string): void {
      this.map.delete(key);
    }
    setItem(key: string, value: string): void {
      this.map.set(key, String(value));
    }
  }
  Object.defineProperty(globalThis, "Storage", { value: ShimStorage, configurable: true });
  Object.defineProperty(globalThis, "localStorage", {
    value: new ShimStorage(),
    configurable: true,
  });
}
installStorageShim();
