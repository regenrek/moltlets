import { createFileRoute, Link } from "@tanstack/react-router"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { RunDetail } from "~/components/runs/run-detail"

export const Route = createFileRoute("/$projectSlug/hosts/$host/runs/$runId")({
  component: RunDetailPage,
})

function RunDetailPage() {
  const { projectSlug, host, runId } = Route.useParams()
  return (
    <RunDetail
      runId={runId as Id<"runs">}
      backLink={<Link to="/$projectSlug/hosts/$host/runs" params={{ projectSlug, host }} />}
    />
  )
}
