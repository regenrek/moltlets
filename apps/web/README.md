# Clawlets Web (TanStack Start + Convex)

Self-hosted web UI for bootstrapping + operating Clawlets projects.

## Dev

1) Install deps (repo root):

```sh
pnpm install
```

2) Login to Convex (if needed):

```sh
cd apps/web
npx convex login
```

3) Create `apps/web/.env.local` from `apps/web/.env.local.example` and run Convex dev once:

```sh
cd apps/web
npx convex dev --once
```

4) Set Convex env vars for Better Auth (local dev deployment):

```sh
cd apps/web
npx convex env set SITE_URL http://localhost:3000
npx convex env set BETTER_AUTH_SECRET "<generate-a-random-secret>"
```

5) Run:

```sh
cd apps/web
pnpm dev
```

### Template source

Project scaffolding defaults to `config/template-source.json` (pinned commit). Override with `CLAWLETS_TEMPLATE_SPEC`.

### Auth config

Auth is enabled by default. Configure Better Auth env vars for both the web app and Convex:

```sh
SITE_URL=http://localhost:3000
BETTER_AUTH_SECRET=... # 32+ chars
VITE_CONVEX_URL=https://<deployment>.convex.cloud
VITE_CONVEX_SITE_URL=https://<deployment>.convex.site
```

Dev-only auth bypass is available for local debugging:

```sh
# apps/web/.env.local
VITE_CLAWLETS_AUTH_DISABLED=true
CLAWLETS_AUTH_DISABLED=true

# Convex deployment env
npx convex env set CLAWLETS_AUTH_DISABLED true
```

## Build

```sh
cd apps/web
pnpm build
```

## Test

```sh
cd apps/web
pnpm test
```
