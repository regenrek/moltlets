import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import alchemy from 'alchemy/cloudflare/tanstack-start'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import mdx from 'fumadocs-mdx/vite'

const alchemyWranglerConfigPath = path.join(
  process.cwd(),
  '.alchemy',
  'local',
  'wrangler.jsonc',
)
const hasAlchemyWranglerConfig = fs.existsSync(alchemyWranglerConfigPath)

export default defineConfig({
  server: {
    port: 5174,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: [
      'fumadocs-mdx:collections/browser',
      'fumadocs-mdx:collections/server',
    ],
  },
  ssr: {
    noExternal: ['fumadocs-ui', 'fumadocs-core', 'fumadocs-mdx'],
  },
  plugins: [
    mdx(await import('./source.config')),
    tailwindcss(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    ...(hasAlchemyWranglerConfig ? [alchemy()] : []),
    tanstackStart({
      prerender: {
        enabled: true,
        routes: ['/', '/docs'],
      },
    }),
    react(),
  ],
})
