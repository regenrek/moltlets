import { useInfiniteQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"

export const Route = createFileRoute("/projects/$projectId/runs")({
  component: RunsPage,
})

function RunsPage() {
  const { projectId } = Route.useParams()
  const router = useRouter()
  const convexQueryClient = router.options.context.convexQueryClient

  const runs = useInfiniteQuery({
    queryKey: ["runsByProject", projectId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const args = {
        projectId: projectId as Id<"projects">,
        paginationOpts: { numItems: 50, cursor: pageParam },
      }
      if (convexQueryClient.serverHttpClient) {
        return await convexQueryClient.serverHttpClient.consistentQuery(api.runs.listByProjectPage, args)
      }
      return await convexQueryClient.convexClient.query(api.runs.listByProjectPage, args)
    },
    getNextPageParam: (lastPage) => (lastPage.isDone ? undefined : lastPage.continueCursor),
    gcTime: 5_000,
  })

  const allRuns = runs.data?.pages.flatMap((p) => p.page) ?? []

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black tracking-tight">Runs</h1>
      <p className="text-muted-foreground">
        History of doctor/bootstrap/deploy/etc with event logs.
      </p>

      {runs.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : runs.error ? (
        <div className="text-sm text-destructive">{String(runs.error)}</div>
      ) : allRuns.length > 0 ? (
        <div className="grid gap-2">
          {allRuns.map((r) => (
            <Link
              key={r._id}
              to="/projects/$projectId/runs/$runId"
              params={{ projectId, runId: r._id }}
              className="rounded-lg border bg-card p-4 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.title || r.kind}</div>
                  <div className="text-muted-foreground text-xs mt-1">
                    {new Date(r.startedAt).toLocaleString()}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">{r.status}</div>
              </div>
            </Link>
          ))}
          {runs.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              disabled={runs.isFetchingNextPage}
              onClick={() => void runs.fetchNextPage()}
            >
              {runs.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="text-muted-foreground">No runs yet.</div>
      )}
    </div>
  )
}
