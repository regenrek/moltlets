import { defineConfig } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import convexPlugin from "@convex-dev/eslint-plugin";

export default defineConfig([
  {
    files: ["convex/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
  },
  ...convexPlugin.configs.recommended,
  {
    ignores: [
      "convex/_generated/**",
      "dist/**",
      "node_modules/**",
    ],
  },
]);

