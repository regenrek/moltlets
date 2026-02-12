/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/react" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string
  readonly VITE_SITE_URL?: string
  readonly VITE_CLAWLETS_AUTH_DISABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
