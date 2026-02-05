import { createFileRoute, Link } from "@tanstack/react-router"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { RunDetail } from "~/components/runs/run-detail"

export const Route = createFileRoute("/$projectSlug/~/runs/$runId")({
  component: RunDetailPage,
})

function RunDetailPage() {
  const { projectSlug, runId } = Route.useParams()
  return (
    <RunDetail
      runId={runId as Id<"runs">}
      backLink={<Link to="/$projectSlug/~/runs" params={{ projectSlug }} />}
    />
  )
}
