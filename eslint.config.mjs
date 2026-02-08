// eslint.config.mjs — Root ESLint config (flat config)
//
// Only rules that Oxlint can't cover yet:
//   1. Ban dynamic import() in all main code (AST selector on ImportExpression)
//   2. Convex best-practice rules (scoped to apps/web/convex)
//
// Oxlint handles everything else (see .oxlintrc.jsonc).

import tsParser from "@typescript-eslint/parser";
import convexPlugin from "@convex-dev/eslint-plugin";

export default [
  // --- Global ignores ---
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/convex/_generated/**",
      "templates/**",
    ],
  },

  // --- Suppress stale eslint-disable comments referencing unloaded plugins ---
  // Codebase may have legacy `// eslint-disable @typescript-eslint/*` or
  // `react-hooks/*` comments; oxlint is the primary linter now.
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },

  // --- TypeScript parser for all TS/TSX files ---
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
  },

  // --- Convex best-practice rules (scoped to apps/web/convex) ---
  ...convexPlugin.configs.recommended.map((config) => {
    // Keep ignores-only configs global
    if (config.ignores && Object.keys(config).length === 1) {
      return config;
    }
    return {
      ...config,
      files: ["apps/web/convex/**/*.{ts,tsx}"],
    };
  }),

  // --- Ban dynamic import() in all main code ---
  // Flags import('x'), await import('x'), Promise.all([import(...)]), etc.
  // Does NOT affect TypeScript's type-only import('x').SomeType (different AST node).
  {
    files: [
      "apps/**/*.{ts,tsx,js,jsx}",
      "packages/**/*.{ts,tsx,js,jsx}",
    ],
    ignores: [
      // tests
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**",
      "**/tests/**",
      // build tooling / config
      "**/vite.config.*",
      "**/vitest.config.*",
      "**/scripts/**",
      // TanStack Router lazy routes use dynamic imports by design
      "**/routes/**",
      // tooling wrappers
      "tools/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message:
            "Don't use dynamic import() in main code (this includes await import()). Prefer static imports. Tests are allowed.",
        },
      ],
    },
  },
];
