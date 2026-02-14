import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { Button } from "~/components/ui/button"
import { requestOpenRunnerStatusDialog } from "~/lib/setup/runner-dialog-events"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { cn } from "~/lib/utils"

export function RunnerStatusBanner(props: {
  projectId: Id<"projects">
  setupHref?: string | null
  className?: string
  runnerOnline?: boolean
  isChecking?: boolean
}) {
  const shouldQuery = typeof props.runnerOnline !== "boolean"
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId: props.projectId }),
    enabled: shouldQuery,
  })

  const runnerOnline = typeof props.runnerOnline === "boolean"
    ? props.runnerOnline
    : isProjectRunnerOnline(runnersQuery.data ?? [])
  const isChecking = typeof props.isChecking === "boolean" ? props.isChecking : runnersQuery.isPending

  if (isChecking || runnerOnline) return null

  return (
    <Alert variant="destructive" className={cn("border-destructive/40 bg-destructive/5", props.className)}>
      <AlertTitle>Runner offline</AlertTitle>
      <AlertDescription>
        <div>Start your runner to continue deploy and secrets operations.</div>
        <div className="pt-1 text-xs text-muted-foreground">
          If it disconnects after a while, open runner logs and check for heartbeat/control-plane errors.
        </div>
      </AlertDescription>
      {props.setupHref ? (
        <AlertAction>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => requestOpenRunnerStatusDialog({ fallbackHref: props.setupHref })}
          >
            Open setup
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  )
}
