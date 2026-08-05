import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Coverage gate (docs/testing.md §3 L1): services/stores must stay at
    // ≥80% lines/functions/statements and ≥70% branches. Run with
    // `pnpm test:coverage`; the plain `pnpm test` (verify path) stays
    // coverage-free to keep CI fast.
    coverage: {
      provider: "v8",
      include: ["src/services/**", "src/stores/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
