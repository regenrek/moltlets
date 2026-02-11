import path from 'node:path'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vitest/config'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'src'),
      src: path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    // Required for createServerFn AST transforms used by sdk/server modules in tests.
    tanstackStart(),
  ],
  ssr: {
    noExternal: ['@convex-dev/better-auth'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      include: [
        'src/lib/auth-utils.ts',
        'src/lib/bootstrap-gate.ts',
        'src/lib/ip-utils.ts',
        'src/lib/utils.ts',
        'src/server/env.ts',
        'src/server/paths.ts',
        'src/server/redaction.ts',
        'src/server/template-spec.ts',
        'src/sdk/runtime/binding.ts',
        'src/sdk/runtime/validators.ts',
        'src/utils/seo.ts',
        'convex/lib/env.ts',
        'convex/lib/errors.ts',
        'convex/lib/rateLimit.ts',
      ],
      exclude: ['**/*.d.ts'],
    },
  },
})
