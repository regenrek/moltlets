skills: ~/.codex/skills

must
- prod-grade, maintainable, scalable
- fix root cause (no band-aids)
- no shims/wrappers/adapters/workarounds
- one canonical impl; ask always to delete dead/legacy paths in same change
- single source of truth for rules/config/validation/enums

rules
- no destructive ops unless asked (rm/reset/clean/force-push)
- no live infra unless asked (bootstrap/lockdown/opentofu apply)
- avoid sindresorhus deps; implement small helpers in-house

never commit (secrets/instance)
- .clawlets/
- .env files (local tokens)
- age keys (operator or host)
- sops config/keys
- opentofu state
- ssh private keys
- any discord tokens/guild ids/api keys

docs
- entry: apps/docs/content/docs/index.mdx
- index: apps/docs/content/docs/meta.json

source of truth
- packages/cli/src and packages/core/src (not dist)
- infra lives in clawlets-template (project repos)
- apps/docs/content/docs/*.mdx and apps/docs/content/docs/meta.json

generated (do not edit)
- packages/*/dist

checks
- pnpm -r test
- cd packages/core && pnpm run coverage

commits
- Conventional Commits


## Coding Style
- Target <=500 LOC (hard cap 750; imports/types excluded).
- Keep UI/markup nesting <=3 levels; extract components/helpers when JSX/templating repeats, responsibilities pile up, or variant/conditional switches grow.

1. Fetch on navigation in route loaders (SSR + streaming); optionally seed via `queryClient.ensureQueryData`. \[1]
2. Do server work on the server via TanStack Start server functions; after mutations call `router.invalidate()` and/or `queryClient.invalidateQueries()`. \[2]
3. Keep page/UI state in the URL with typed search params (`validateSearch`, `Route.useSearch`, `navigate`). \[3]
4. Reserve effects for real external effects only (DOM, subscriptions, analytics). Compute derived state during render; `useMemo` only if expensive. \[4]\[6]
5. Hydration + Suspense: any update that suspends during hydration replaces SSR content with fallbacks. Wrap sync updates that might suspend in `startTransition` (direct import). Avoid rendering `isPending` during hydration. `useSyncExternalStore` always triggers fallbacks during hydration. \[10]
6. Data placement:

   * Server-synced domain data → TanStack DB collections (often powered by TanStack Query via `queryCollectionOptions`, or a sync engine). Read with live queries. \[11]\[12]\[14]
   * Ephemeral UI/session (theme, modals, steppers, optimistic buffers) → zustand or local-only/localStorage collection. Do not mirror server data into zustand. \[16]\[14]
   * Derived views → compute in render or via live queries. \[12]

# if your useEffect did X → use Y

* Fetch on mount/param change → route loader (+ `ensureQueryData`). \[1]
* Submit/mutate → server function → then `router.invalidate()`/`qc.invalidateQueries()`. \[2]
* Sync UI ↔ querystring → typed search params + `navigate`. \[3]
* Derived state → compute during render (`useMemo` only if expensive). \[4]
* Subscribe external stores → `useSyncExternalStore` (expect hydration fallbacks). \[5]\[10]
* DOM/listeners/widgets → small `useEffect`/`useLayoutEffect`. \[6]
* Synced list + optimistic UI → DB query collection + `onInsert`/`onUpdate`/`onDelete` or server fn + invalidate. \[11]\[13]
* Realtime websocket/SSE patches → TanStack DB direct writes (`writeInsert/update/delete/upsert/batch`). \[13]
* Joins/aggregations → live queries. \[12]
* Local-only prefs/cross-tab → localStorage collection (no effects). \[14]

# idioms (names only)

* Loader: `queryClient.ensureQueryData(queryOptions({ queryKey, queryFn }))` → read via `useSuspenseQuery` hydrated from loader. \[1]
* DB query collection: `createCollection(queryCollectionOptions({ queryKey, queryFn, queryClient, getKey }))` → read via live query. \[11]\[12]
* Mutation (server-first): `createServerFn(...).handler(...)` → on success `qc.invalidateQueries`, `router.invalidate`; supports `<form action={serverFn.url}>`. \[2]
* DB persistence handlers: `onInsert`/`onUpdate`/`onDelete` → return `{ refetch?: boolean }`; pair with direct writes when skipping refetch. \[13]
* Search params as state: `validateSearch → Route.useSearch → navigate({ search })`. \[3]
* External store read: `useSyncExternalStore(subscribe, getSnapshot)`. \[5]
* Hydration-safe: `import { startTransition } from 'react'` for sync updates; avoid `useTransition`/`isPending` during hydration. \[10]

# decision checklist

* Needed at render → loader (defer/stream). \[1]\[7]
* User changed data → server fn → invalidate; or DB handlers/direct writes. \[2]\[13]
* Belongs in URL → typed search params. \[3]
* Purely derived → render/live query. \[4]\[12]
* External system only → effect. \[6]
* Hydration sensitive → `startTransition` for sync updates; expect fallbacks from external stores; avoid `isPending` during hydration. \[10]
* SSR/SEO → loader-based fetching with streaming/deferred; dehydrate/hydrate caches and DB snapshots. \[7]

# React 19 helpers

* `useActionState` for form pending/error/result. \[8]
* `use` to suspend on promises. \[9]

# hydration + suspense playbook \[10]

* Rule: sync updates that suspend during hydration → fallback replaces SSR.
* Quick fix: wrap updates with `startTransition` (direct import); re-wrap after `await`.
* Avoid during hydration: using `useTransition` for the update, rendering `isPending`, `useDeferredValue` unless the suspensey child is memoized, any `useSyncExternalStore` mutation.
* Safe during hydration: setting same value with `useState`/`useReducer`, `startTransition`-wrapped sync updates, `useDeferredValue` with `React.memo` around the suspensey child.
* Compiler auto-memoization may help; treat as optimization.

## Zustand in TanStack Start

* Use for client/UI/session and push-based domain state (theme, modals, wizards, optimistic UI, websocket buffers). Keep server data in loaders/Query.
* Per-request store instance to avoid SSR leaks; inject via Router context; dehydrate/hydrate via `router.dehydrate`/`router.hydrate` so snapshots stream with the page.
* After navigation resolution, clear transient UI with `router.subscribe('onResolved', ...)`.
* Mutations: do work in server fn → optionally update store optimistically → `router.invalidate` to reconcile with loader data.
* Persist middleware only for client/session; avoid touching storage during SSR.
* Use atomic selectors (`useStore(s => slice)`) and equality helpers.


## docs map

\[1] router data loading · \[2] server functions · \[3] search params · \[4] you might not need an effect · \[5] `useSyncExternalStore` · \[6] synchronizing with effects · \[7] SSR/streaming · \[8] `useActionState` · \[9] `use` · \[10] hydration + suspense guide · \[11] TanStack DB query collection · \[12] live queries · \[13] direct writes + persistence handlers · \[14] collections catalog · \[15] transactions + optimistic actions · \[16] zustand in TanStack Start