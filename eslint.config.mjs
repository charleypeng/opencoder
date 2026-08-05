import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid";

// Vitest globals are enabled via vitest.config.ts `globals: true`.
const vitestGlobals = {
  describe: "readonly",
  it: "readonly",
  test: "readonly",
  expect: "readonly",
  vi: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  afterAll: "readonly",
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "src/services/api/schema.d.ts",
      "**/*.tsbuildinfo",
      "vite.config.js",
      "vite.config.d.ts",
      "vitest.config.js",
      "vitest.config.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  solid.configs["flat/recommended"],
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["**/*.{ts,tsx,mjs,js}", "!src/**"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // E2E harness runs in the browser (Playwright) — the shim needs both
    // the DOM and Node globals.
    files: ["tests/e2e/**"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "vitest.setup.ts"],
    languageOptions: {
      globals: vitestGlobals,
    },
  },
);
