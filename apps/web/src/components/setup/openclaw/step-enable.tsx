import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { Id } from "../../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { Button } from "~/components/ui/button"
import { configDotBatch } from "~/sdk/config"

export function OpenClawSetupStepEnable(props: {
  projectId: Id<"projects">
  host: string
  isComplete: boolean
  onContinue: () => void
}) {
  const queryClient = useQueryClient()
  const enable = useMutation({
    mutationFn: async () => {
      return await configDotBatch({
        data: {
          projectId: props.projectId,
          ops: [
            { path: `hosts.${props.host}.openclaw.enable`, valueJson: "true" },
          ],
        },
      })
    },
    onSuccess: async () => {
    },
  })

  const runId = enable.data && (enable.data as any).ok ? (enable.data as any).runId as Id<"runs"> : null
  const issues = enable.data && !(enable.data as any).ok ? (enable.data as any).issues : null

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Enables OpenClaw for this host. If <code>fleet/openclaw.json</code> or the host entry is missing, this creates it.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={enable.isPending || props.isComplete} onClick={() => enable.mutate()}>
          {props.isComplete ? "OpenClaw already enabled" : "Enable OpenClaw"}
        </Button>
        <Button type="button" variant="outline" disabled={!props.isComplete} onClick={props.onContinue}>
          Continue
        </Button>
      </div>
      {issues?.length ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {JSON.stringify(issues, null, 2)}
        </div>
      ) : null}
      {runId ? (
        <RunLogTail
          runId={runId}
          onDone={(status) => {
            if (status === "succeeded") props.onContinue()
          }}
        />
      ) : null}
    </div>
  )
}
