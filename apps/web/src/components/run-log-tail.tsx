import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import * as React from "react"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { cancelRun } from "~/sdk/runtime"

type RunDoneStatus = "succeeded" | "failed" | "canceled"

export function RunLogTail(props: { runId: Id<"runs">; onDone?: (status: RunDoneStatus) => void }) {
  return <RunLogTailBody key={props.runId} {...props} />
}

function RunLogTailBody({ runId, onDone }: { runId: Id<"runs">; onDone?: (status: RunDoneStatus) => void }) {
  const router = useRouter()
  const convexQueryClient = router.options.context.convexQueryClient
  const runQuery = useQuery({ ...convexQuery(api.controlPlane.runs.get, { runId }) })
  const pageQuery = useQuery({
    ...convexQuery(api.controlPlane.runEvents.pageByRun, { runId, paginationOpts: { numItems: 300, cursor: null } }),
  })

  type RunEventsPage = NonNullable<typeof pageQuery.data>
  const [olderPages, setOlderPages] = React.useState<RunEventsPage[]>([])
  const [canceling, setCanceling] = React.useState(false)
  const firstPage = pageQuery.data
  const lastOlderPage = olderPages[olderPages.length - 1] ?? null
  const continueCursor = lastOlderPage ? lastOlderPage.continueCursor : firstPage?.continueCursor ?? null
  const isDone = lastOlderPage ? lastOlderPage.isDone : firstPage?.isDone ?? true
  const canLoadOlder = Boolean(firstPage && continueCursor && !isDone)

  const loadOlder = useMutation({
    mutationFn: async () => {
      if (!continueCursor || isDone) return null
      const args = { runId, paginationOpts: { numItems: 300, cursor: continueCursor } }
      if (convexQueryClient.serverHttpClient) {
        return await convexQueryClient.serverHttpClient.consistentQuery(api.controlPlane.runEvents.pageByRun, args)
      }
      return await convexQueryClient.convexClient.query(api.controlPlane.runEvents.pageByRun, args)
    },
    onSuccess: (result) => {
      if (!result) return
      setOlderPages((prev) => [...prev, result])
    },
  })

  const eventsDesc = [
    ...(firstPage?.page ?? []),
    ...olderPages.flatMap((page) => page.page),
  ]
  const seen = new Set<string>()
  const events = eventsDesc
    .slice()
    .toReversed()
    .filter((event) => {
      if (seen.has(event._id)) return false
      seen.add(event._id)
      return true
    })

  const run = runQuery.data?.run
  const runStatus = run?.status
  const doneStatus: RunDoneStatus | null =
    runStatus === "succeeded" || runStatus === "failed" || runStatus === "canceled"
      ? runStatus
      : null
  const notifiedDoneStatus = React.useRef<RunDoneStatus | null>(null)

  if (doneStatus && onDone && notifiedDoneStatus.current !== doneStatus) {
    notifiedDoneStatus.current = doneStatus
    queueMicrotask(() => onDone(doneStatus))
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
        <div className="min-w-0">
          <div className="font-medium truncate">{run?.title || "Run"}</div>
          <div className="text-muted-foreground text-xs">
            Status: {run?.status ?? "…"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canLoadOlder ? (
            <AsyncButton
              size="sm"
              variant="outline"
              type="button"
              disabled={loadOlder.isPending}
              pending={loadOlder.isPending}
              pendingText="Loading..."
              onClick={() => loadOlder.mutate()}
            >
              Load older
            </AsyncButton>
          ) : null}
          {run?.status === "running" ? (
            <AsyncButton
              size="sm"
              variant="outline"
              type="button"
              disabled={canceling}
              pending={canceling}
              pendingText="Canceling..."
              onClick={() => {
                void (async () => {
                  setCanceling(true)
                  try {
                    await cancelRun({ data: { runId } })
                  } finally {
                    setCanceling(false)
                  }
                })()
              }}
            >
              Cancel
            </AsyncButton>
          ) : null}
        </div>
      </div>
      <div className="p-4">
        <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words max-h-[420px] overflow-auto">
          {pageQuery.isPending ? (
            <span className="text-muted-foreground">Loading…</span>
          ) : events.length === 0 ? (
            <span className="text-muted-foreground">No logs yet.</span>
          ) : (
            events.map((event) => `${new Date(event.ts).toLocaleTimeString()} ${event.level} ${event.message}`).join("\n")
          )}
        </pre>
      </div>
    </div>
  )
}
