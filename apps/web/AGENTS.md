
# web app rules

inherits: ../../AGENTS.md (coding style, data placement, effect rules, idioms, decision checklist, hydration playbook, zustand, docs map)

stack: TanStack Start + TanStack Query + Convex + Better Auth + shadcn/ui + Tailwind v4

## effects — when NOT to use

Derived from react.dev/learn/you-might-not-need-an-effect [4]:

- derived state from props/state → compute during render, not in effect
- expensive derived state → `useMemo`, not effect + setState
- reset all state on prop change → `key={id}` on component, not effect
- reset partial state on prop change → store ID not object; derive via `.find()` during render
- event-specific logic (submit, click) → event handler, not effect
- shared logic between handlers → extract function, call from handlers
- POST on user action → event handler; POST on mount (analytics) → effect is fine
- chained effects adjusting state → compute in event handler or during render
- app-init logic → top-level module guard (`if (!didInit)`) or outside component
- notify parent of state change → call parent callback in event handler, not effect
- pass data to parent → lift data fetching to parent, pass down as props
- subscribe external store → `useSyncExternalStore`, not manual effect
- data fetching → route loader preferred; if effect, add cleanup (`let ignore = false`) to prevent race conditions

## route and loader conventions

- file-based routes in `src/routes/`
- loaders use `ensureQueryData` for SSR prefetch: `await context.queryClient.ensureQueryData(queryOpts)`
- parallel prefetch in loaders when independent: `await Promise.all([ensureA, ensureB])`
- conditional loader skip when entity not ready: `if (project?.status !== "ready") return`
- redirects belong in `beforeLoad`, not in `useEffect` after data loads
- route params: `Route.useParams()` (typed)
- search params as state: `validateSearch` → `Route.useSearch()` → `navigate({ search })`

## query options

centralized in `src/lib/query-options.ts`

- wrap Convex queries: `convexQuery(api.table.fn, args)` from `@convex-dev/react-query`
- factory pattern: `export function fooQueryOptions(id) { return { ...convexQuery(api.foo.get, { id }), staleTime: 10_000 } }`
- query key factories use `as const`: `{ dashboardOverview: ["dashboardOverview"] as const }`
- read in components: `useSuspenseQuery(fooQueryOptions(id))` — no separate queryKey/queryFn
- mutations: `useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey }) })`
- optimistic: `qc.setQueryData(key, updater)` before server confirms; rollback on error
- no `useQuery` when `useSuspenseQuery` fits (avoids loading state boilerplate)
- no `skipToken` with `useSuspenseQuery`

## Convex patterns

queries/mutations:
- always include `args` and `returns` validators; use `v.null()` if no return
- `withIndex()` over `filter()` for indexed fields
- `.unique()` for single-document lookups
- mutations are transactional; batch related ops in one mutation
- schedule background work: `ctx.scheduler.runAfter()` not inline
- actions: `"use node"` at top; never use `ctx.db` directly, use `ctx.runQuery()`/`ctx.runMutation()`

schema:
- index name matches fields: `by_user_and_status` for `["userId", "status"]`
- new fields start as `v.optional()`, backfill, then make required
- `v.union(v.literal("a"), v.literal("b"))` for discriminated unions

subscriptions:
- `useQuery()` auto-subscribes; handle `undefined` as loading
- conditional: `useQuery(api.fn, cond ? { args } : "skip")` — never conditional hook calls
- pagination: `usePaginatedQuery(api.fn, args, { initialNumItems: 20 })`, status: `"CanLoadMore"` / `"Exhausted"`

files:
- upload: `generateUploadUrl()` → `fetch(url, { method: "POST", body: file })` → save `storageId`
- serve: `ctx.storage.getUrl(storageId)` (signed, temporary)
- delete both storage and db record to avoid orphans
- metadata: `ctx.db.system.get(storageId)` not deprecated `getMetadata`

errors:
- `throw new ConvexError("msg")` for user-facing errors
- structured: `throw new ConvexError({ code: "UNAUTHENTICATED", message: "..." })`
- queries return `null` for missing items (don't reveal existence); mutations throw

security:
- always verify `ctx.auth.getUserIdentity()` in sensitive functions
- verify ownership before update/delete: `if (doc.userId !== user._id) throw`
- use `internalMutation`/`internalQuery` for sensitive ops (credits, payments, admin)
- never expose API keys in responses; use `process.env` in actions only
- never use `v.any()` for sensitive data

## auth (Convex Better Auth)

setup:
- backend: `createClient()` from `@convex-dev/better-auth` returns `adapter()`, `getAuthUser()`, `safeGetAuthUser()`, `getHeaders()`
- routes: `authComponent.registerRoutes(http, createAuth)` → `/api/auth/*`
- client: `<ConvexBetterAuthProvider>` wraps `<ConvexProviderWithAuth>`
- session hooks: `authClient.useSession()`, `useConvexAuth()` for `{ isLoading, isAuthenticated }`

server-side auth in Convex functions:
- required: `const user = await getUser(ctx)` — throws if unauthed
- optional: `const user = await safeGetUser(ctx)` — returns null
- never trust client-provided userId; verify via `tokenIdentifier`

protected routes:
- `beforeLoad: ({ context }) => { if (!context.isAuthenticated) throw redirect({ to: '/sign-in' }) }`
- root route `beforeLoad` checks auth and sets Convex token
- auth error watcher subscribes to query cache, redirects on auth errors

known anti-patterns in codebase:
- `src/routes/index.tsx` uses `useEffect` for navigation after data loads → move to loader + redirect
- `src/routes/__root.tsx` has multiple `useEffect` for auth logic → consolidate into route guards
- prefer `beforeLoad` redirects over `useEffect`-based navigation

## coding style (2026)

inherits parent LOC rule: <=500 per file (hard cap 750; imports/types excluded)

component sizing:
- aim 50-250 LOC per component; split at responsibility boundary, not arbitrary line count
- one exported component per file; private helpers/sub-components in same file OK
- never define components inside other components (breaks React reconciliation + caching)
- prefer early returns for guard clauses and error states

React Compiler (auto-memoization):
- do not manually add `useMemo`, `useCallback`, or `React.memo` for perf — compiler handles it
- write plain idiomatic React; compiler memoizes where it matters at build time
- manual memo is acceptable only if compiler is not enabled or for measured hot paths
- compiler works best when code follows React rules of hooks and pure render functions

React 19 hooks:
- `useActionState(action, initialState)` for form pending/error/result — replaces manual onSubmit + useState boilerplate
- `useFormStatus()` in child of `<form>` for `{ pending, data, method }` — no prop-drilling loading state
- `useOptimistic(state, updateFn)` for instant UI feedback during async ops; auto-rollback on error
- `use(promise)` to suspend on promises in render — replaces `useEffect` + loading state for simple cases
- prefer `<form action={serverFn}>` over `onClick` + `fetch` for mutations when applicable

TypeScript:
- prefer `satisfies` over type assertions (`as`): validates without widening inferred type
- `as const satisfies Type` for config objects: type-checks + preserves literal types + deep readonly
- strict typing; avoid `any`; use `unknown` + narrowing when type is truly unknown
- use discriminated unions (`type: "a" | "b"`) over boolean flags for state variants

server functions (TanStack Start):
- `createServerFn({ method: 'GET' | 'POST' }).handler(async (ctx) => {})` for server-only work
- call from loaders (GET) or mutations (POST); client never sees implementation
- after POST mutations: `router.invalidate()` and/or `queryClient.invalidateQueries()`
- composite components pattern: client fetches/caches/composes server components on its own terms

## UI conventions

- shadcn/ui components in `src/components/ui/`
- Tailwind v4 via `@tailwindcss/vite`
- icons: lucide-react primary, heroicons secondary
- toasts: sonner (`toast()`)
- loading/error: check `isPending`/`error` from query hooks; show skeleton or error boundary
- nesting <=3 levels; extract when JSX repeats or conditionals grow

## docs map

[1] router data loading · [2] server functions · [3] search params · [4] you might not need an effect · [5] useSyncExternalStore · [6] synchronizing with effects · [7] SSR/streaming · [8] useActionState · [9] use · [10] hydration + suspense guide · [11] TanStack DB query collection · [12] live queries · [13] direct writes + persistence handlers · [14] collections catalog · [15] transactions + optimistic actions · [16] zustand in TanStack Start
