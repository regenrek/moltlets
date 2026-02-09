import { useInfiniteQuery } from "@tanstack/react-query"
import { Link, useRouter } from "@tanstack/react-router"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"

type RunsListProps = {
  projectSlug: string
  projectId: Id<"projects">
  host?: string | null
}

function RunsList({ projectSlug, projectId, host }: RunsListProps) {
  const router = useRouter()
  const convexQueryClient = router.options.context.convexQueryClient
  const hasServerHttpClient = Boolean(convexQueryClient.serverHttpClient)
  const hostFilter = host?.trim() || null

  const runs = useInfiniteQuery({
    queryKey: ["runsByProject", projectId, hostFilter, hasServerHttpClient],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const args = {
        projectId,
        paginationOpts: { numItems: 50, cursor: pageParam },
      } as any
      if (hostFilter) args.host = hostFilter
      if (hasServerHttpClient) {
        return hostFilter
          ? await convexQueryClient.serverHttpClient!.consistentQuery(
            api.controlPlane.runs.listByProjectHostPage,
            args,
          )
          : await convexQueryClient.serverHttpClient!.consistentQuery(
            api.controlPlane.runs.listByProjectPage,
            args,
          )
      }
      return hostFilter
        ? await convexQueryClient.convexClient.query(
          api.controlPlane.runs.listByProjectHostPage,
          args,
        )
        : await convexQueryClient.convexClient.query(api.controlPlane.runs.listByProjectPage, args)
    },
    getNextPageParam: (lastPage) =>
      lastPage.isDone ? undefined : lastPage.continueCursor,
    enabled: Boolean(projectId) && (!host || Boolean(hostFilter)),
  })

  const allRuns = runs.data?.pages.flatMap((p) => p.page) ?? []
  const detailRoute = hostFilter
    ? "/$projectSlug/hosts/$host/runs/$runId"
    : "/$projectSlug/~/runs/$runId"

  return runs.isPending ? (
    <div className="text-muted-foreground">Loading…</div>
  ) : runs.error ? (
    <div className="text-sm text-destructive">{String(runs.error)}</div>
  ) : allRuns.length > 0 ? (
    <div className="grid gap-2">
      {allRuns.map((r) => (
        <Link
          key={r._id}
          to={detailRoute}
          params={
            hostFilter
              ? { projectSlug, host: hostFilter, runId: r._id }
              : { projectSlug, runId: r._id }
          }
          className="rounded-lg border bg-card p-4 hover:bg-accent/30 transition-colors"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium truncate">{r.title || r.kind}</div>
              <div className="text-muted-foreground text-xs mt-1">
                {new Date(r.startedAt).toLocaleString()}
                {!hostFilter && r.host ? ` • ${r.host}` : ""}
              </div>
            </div>
            <div className="text-xs text-muted-foreground shrink-0">{r.status}</div>
          </div>
        </Link>
      ))}
      {runs.hasNextPage ? (
        <AsyncButton
          type="button"
          variant="outline"
          disabled={runs.isFetchingNextPage}
          pending={runs.isFetchingNextPage}
          pendingText="Loading..."
          onClick={() => void runs.fetchNextPage()}
        >
          Load more
        </AsyncButton>
      ) : null}
    </div>
  ) : (
    <div className="text-muted-foreground">No runs yet.</div>
  )
}

export { RunsList }
export type { RunsListProps }
