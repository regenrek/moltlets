import type { Id } from "../../../../convex/_generated/dataModel"
import { Link } from "@tanstack/react-router"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import { Button } from "~/components/ui/button"
import type { SetupStepStatus } from "~/lib/setup/setup-model"

export function SetupStepVerify(props: {
  projectSlug: string
  projectId: Id<"projects">
  host: string
  config: any
  stepStatus: SetupStepStatus
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-lg font-medium">Post-bootstrap verification</div>
            <div className="text-xs text-muted-foreground">Continue host security checks from the setup flow.</div>
          </div>
          <SetupStepStatusBadge status={props.stepStatus} />
        </div>
        <div className="text-sm text-muted-foreground">
          Use the host setup stepper for lock-down and verification actions.
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link
            to="/$projectSlug/hosts/$host/settings/vpn"
            params={{ projectSlug: props.projectSlug, host: props.host }}
          />}
        >
          Open VPN settings
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/$projectSlug/hosts/$host/deploy" params={{ projectSlug: props.projectSlug, host: props.host }} />}
        >
          Back to Deploy
        </Button>
      </div>
    </div>
  )
}
