import type { ReactElement } from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { Button } from "~/components/ui/button"

type RunDetailProps = {
  runId: Id<"runs">
  backLink: ReactElement
}

function RunDetail({ runId, backLink }: RunDetailProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Run</h1>
          <p className="text-muted-foreground">Realtime logs and status.</p>
        </div>
        <Button variant="outline" nativeButton={false} render={backLink}>
          Back
        </Button>
      </div>

      <RunLogTail runId={runId} />
    </div>
  )
}

export { RunDetail }
export type { RunDetailProps }
